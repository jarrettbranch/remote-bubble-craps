import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { AuthIdentity, AuthVerifier } from "../auth.js";
import { AppConfig } from "../config.js";
import {
  DiceDevice,
  DiceDeviceStatus,
  DiceResult
} from "../device/DiceDevice.js";
import { BubbleCrapsServer } from "../gameServer.js";
import { ServerMessage } from "../messages.js";

class FixedDiceDevice implements DiceDevice {
  private callback: ((result: DiceResult) => void) | null = null;
  private status: DiceDeviceStatus = {
    kind: "simulated",
    label: "Simulated",
    connected: false,
    rolling: false,
    lastError: null
  };

  constructor(private readonly die1: number, private readonly die2: number) {}

  async connect(): Promise<void> {
    this.status = { ...this.status, connected: true };
  }

  async disconnect(): Promise<void> {
    this.status = { ...this.status, connected: false, rolling: false };
  }

  getStatus(): DiceDeviceStatus {
    return this.status;
  }

  async requestRoll(rollId: string): Promise<void> {
    this.status = { ...this.status, rolling: true };
    queueMicrotask(() => {
      this.status = { ...this.status, rolling: false };
      this.callback?.({ rollId, die1: this.die1, die2: this.die2 });
    });
  }

  onResult(callback: (result: DiceResult) => void): () => void {
    this.callback = callback;
    return () => {
      if (this.callback === callback) {
        this.callback = null;
      }
    };
  }
}

class FixedAuthVerifier implements AuthVerifier {
  async verify(_accessToken: string): Promise<AuthIdentity> {
    return {
      provider: "entra",
      subject: "https://issuer.example|subject-1",
      displayName: "Entra Player",
      email: "player@example.test",
      issuer: "https://issuer.example"
    };
  }
}

describe("BubbleCrapsServer integration", () => {
  let server: BubbleCrapsServer | null = null;
  let socket: WebSocket | null = null;

  afterEach(async () => {
    socket?.close();
    socket = null;
    await server?.close();
    server = null;
  });

  it("covers join -> bet -> lock -> roll -> settlement", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "bubble-craps-")), "test.sqlite");
    const config = testConfig(databasePath);

    server = new BubbleCrapsServer({
      config,
      device: new FixedDiceDevice(3, 4)
    });
    await server.listen(0);

    socket = new WebSocket(server.url);
    const messages: ServerMessage[] = [];
    socket.on("message", (data) => {
      messages.push(JSON.parse(data.toString()) as ServerMessage);
    });

    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "join", displayName: "Tester" }));

    const joined = await waitForMessage(messages, (message) => message.type === "joined");
    expect(joined).toMatchObject({ type: "joined" });
    const playerId = joined.type === "joined" ? joined.playerId : "";

    socket.send(
      JSON.stringify({ type: "placeBet", kind: "passLine", amount: 10 })
    );

    await waitForMessage(
      messages,
      (message) =>
        message.type === "state" &&
        message.state.players[playerId]?.balance === 90 &&
        message.state.bets.length === 1
    );

    await waitForMessage(
      messages,
      (message) => message.type === "state" && message.state.betting.status === "locked"
    );

    socket.send(JSON.stringify({ type: "requestRoll" }));

    const settled = await waitForMessage(
      messages,
      (message) =>
        message.type === "state" &&
        message.state.lastRoll?.total === 7 &&
        message.state.players[playerId]?.balance === 110 &&
        message.state.bets.length === 0
    );

    expect(settled.type).toBe("state");
    const events = server.recentEvents();
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "player_joined",
        "bet_placed",
        "roll_requested",
        "dice_result",
        "payouts"
      ])
    );
  });

  it("covers join -> rebuy chips -> persisted ledger event", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "bubble-craps-")), "test.sqlite");
    const config = testConfig(databasePath);

    server = new BubbleCrapsServer({
      config,
      device: new FixedDiceDevice(3, 4)
    });
    await server.listen(0);

    socket = new WebSocket(server.url);
    const messages: ServerMessage[] = [];
    socket.on("message", (data) => {
      messages.push(JSON.parse(data.toString()) as ServerMessage);
    });

    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "join", displayName: "Buyer" }));

    const joined = await waitForMessage(messages, (message) => message.type === "joined");
    const playerId = joined.type === "joined" ? joined.playerId : "";

    socket.send(JSON.stringify({ type: "rebuyChips" }));

    await waitForMessage(
      messages,
      (message) =>
        message.type === "state" &&
        message.state.players[playerId]?.balance === 2100 &&
        message.state.players[playerId]?.totalBuyIns === 2000
    );

    expect(server.recentEvents().map((event) => event.type)).toContain("chips_rebought");
  });

  it("rotates shooter and preserves bets when the shooter times out", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "bubble-craps-")), "test.sqlite");
    const config = {
      ...testConfig(databasePath),
      bettingCountdownMs: 100,
      rollTimeoutMs: 100
    };

    server = new BubbleCrapsServer({
      config,
      device: new FixedDiceDevice(3, 4)
    });
    await server.listen(0);

    const firstSocket = new WebSocket(server.url);
    const secondSocket = new WebSocket(server.url);
    socket = firstSocket;
    const messages: ServerMessage[] = [];
    firstSocket.on("message", (data) => {
      messages.push(JSON.parse(data.toString()) as ServerMessage);
    });
    secondSocket.on("message", (data) => {
      messages.push(JSON.parse(data.toString()) as ServerMessage);
    });

    await Promise.all([waitForOpen(firstSocket), waitForOpen(secondSocket)]);
    firstSocket.send(JSON.stringify({ type: "join", displayName: "Slow" }));
    const firstJoined = await waitForMessage(messages, (message) => message.type === "joined");
    const firstPlayerId = firstJoined.type === "joined" ? firstJoined.playerId : "";
    secondSocket.send(JSON.stringify({ type: "join", displayName: "Next" }));
    const secondJoined = await waitForMessage(
      messages,
      (message) => message.type === "joined" && message.playerId !== firstPlayerId
    );
    const secondPlayerId = secondJoined.type === "joined" ? secondJoined.playerId : "";

    firstSocket.send(
      JSON.stringify({ type: "placeBet", kind: "passLine", amount: 10 })
    );

    await waitForMessage(
      messages,
      (message) =>
        message.type === "state" &&
        message.state.bets.length === 1 &&
        message.state.shooterId === firstPlayerId
    );

    const afterTimeout = await waitForMessage(
      messages,
      (message) =>
        message.type === "state" &&
        message.state.betting.status === "open" &&
        message.state.shooterId === secondPlayerId &&
        message.state.bets.length === 1 &&
        message.state.notices.some((notice) => notice.type === "roll_timeout")
    );

    expect(afterTimeout.type).toBe("state");
    expect(server.recentEvents().map((event) => event.type)).toContain("roll_timeout");
    secondSocket.close();
  });

  it("authenticates an Entra user and reconnects to the same chip ledger", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "bubble-craps-")), "test.sqlite");
    const config = {
      ...testConfig(databasePath),
      authMode: "entra" as const,
      entraAuthority: "https://login.example.test/tenant/v2.0",
      entraAudience: "api://bubble-craps"
    };

    server = new BubbleCrapsServer({
      config,
      device: new FixedDiceDevice(3, 4),
      authVerifier: new FixedAuthVerifier()
    });
    await server.listen(0);

    socket = new WebSocket(server.url);
    const messages: ServerMessage[] = [];
    socket.on("message", (data) => {
      messages.push(JSON.parse(data.toString()) as ServerMessage);
    });

    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "authenticate", accessToken: "mock-token" }));

    const authenticated = await waitForMessage(
      messages,
      (message) => message.type === "authenticated"
    );
    const playerId = authenticated.type === "authenticated" ? authenticated.playerId : "";

    socket.send(JSON.stringify({ type: "rebuyChips" }));
    await waitForMessage(
      messages,
      (message) =>
        message.type === "state" &&
        message.state.players[playerId]?.balance === 2100 &&
        message.state.players[playerId]?.totalBuyIns === 2000
    );

    socket.close();
    socket = new WebSocket(server.url);
    const reconnectMessages: ServerMessage[] = [];
    socket.on("message", (data) => {
      reconnectMessages.push(JSON.parse(data.toString()) as ServerMessage);
    });

    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "authenticate", accessToken: "mock-token" }));

    const reauthenticated = await waitForMessage(
      reconnectMessages,
      (message) => message.type === "authenticated"
    );
    expect(reauthenticated).toMatchObject({ type: "authenticated", playerId });

    await waitForMessage(
      reconnectMessages,
      (message) =>
        message.type === "state" &&
        message.state.players[playerId]?.balance === 2100 &&
        message.state.players[playerId]?.totalBuyIns === 2000
    );
  });
});

function testConfig(databasePath: string): AppConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    databasePath,
    bettingCountdownMs: 100,
    startingBalance: 100,
    simulatedRollDelayMs: 0,
    rebuyChips: 2000,
    rollTimeoutMs: 30_000,
    authMode: "local",
    entraAuthority: null,
    entraAudience: null,
    entraIssuer: null
  };
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function waitForMessage(
  messages: ServerMessage[],
  predicate: (message: ServerMessage) => boolean
): Promise<ServerMessage> {
  const existing = messages.find(predicate);
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const found = messages.find(predicate);
      if (found) {
        clearInterval(timer);
        resolve(found);
        return;
      }

      if (Date.now() - startedAt > 1500) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for WebSocket message."));
      }
    }, 5);
  });
}
