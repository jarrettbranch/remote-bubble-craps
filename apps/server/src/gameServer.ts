import { createServer, Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import {
  addTableNotice,
  addChatMessage,
  addPlayer,
  BET_DEFINITIONS,
  BetKind,
  createInitialGameState,
  disconnectPlayer,
  GameState,
  lockBetting,
  openBetting,
  placeBet,
  rebuyPlayer,
  removeBet,
  rotateShooter,
  settleRoll,
  updateDevice
} from "@bubble-craps/shared";
import { WebSocket, WebSocketServer } from "ws";
import { AuthVerifier, EntraJwtVerifier } from "./auth.js";
import { AppConfig } from "./config.js";
import { DiceDevice, DiceResult } from "./device/DiceDevice.js";
import { EventStore, StoredUser } from "./eventStore.js";
import { ClientMessage, ServerMessage } from "./messages.js";

interface Session {
  playerId: string | null;
}

export interface BubbleCrapsServerOptions {
  config: AppConfig;
  device: DiceDevice;
  eventStore?: EventStore;
  authVerifier?: AuthVerifier;
}

export class BubbleCrapsServer {
  private readonly config: AppConfig;
  private readonly device: DiceDevice;
  private readonly eventStore: EventStore;
  private readonly authVerifier: AuthVerifier | null;
  private readonly httpServer: HttpServer;
  private readonly wss: WebSocketServer;
  private readonly sessions = new Map<WebSocket, Session>();
  private state: GameState;
  private lockTimer: NodeJS.Timeout | null = null;
  private rollTimeoutTimer: NodeJS.Timeout | null = null;
  private broadcastTicker: NodeJS.Timeout | null = null;
  private pendingRollId: string | null = null;
  private removeDeviceListener: (() => void) | null = null;

  constructor(options: BubbleCrapsServerOptions) {
    this.config = options.config;
    this.device = options.device;
    this.eventStore =
      options.eventStore ?? new EventStore(options.config.databasePath);
    this.authVerifier = options.authVerifier ?? createAuthVerifier(options.config);
    this.state = normalizePersistedState(
      this.eventStore.loadGameState() ??
        createInitialGameState({
          bettingDurationMs: options.config.bettingCountdownMs,
          device: this.device.getStatus()
        }),
      this.device.getStatus(),
      options.config.bettingCountdownMs
    );

    this.httpServer = createServer((request, response) => {
      if (request.url === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      if (request.url === "/events") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(this.eventStore.recent(100)));
        return;
      }

      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Not found" }));
    });

    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: "/ws"
    });

    this.wss.on("connection", (socket) => this.handleConnection(socket));
  }

  async listen(port = this.config.port): Promise<number> {
    this.removeDeviceListener = this.device.onResult((result) => {
      void this.handleDiceResult(result);
    });

    try {
      await this.device.connect();
    } finally {
      this.state = updateDevice(this.state, this.device.getStatus());
    }

    await new Promise<void>((resolve) => {
      this.httpServer.listen(port, this.config.host, resolve);
    });

    this.openBettingWindow();
    this.broadcastTicker = setInterval(() => {
      if (this.state.betting.status === "open") {
        this.broadcastState();
      }
    }, 1000);

    return this.port;
  }

  get port(): number {
    const address = this.httpServer.address() as AddressInfo | null;
    return address?.port ?? this.config.port;
  }

  get url(): string {
    const host = this.config.host === "0.0.0.0" ? "127.0.0.1" : this.config.host;
    return `ws://${host}:${this.port}/ws`;
  }

  getState(): GameState {
    return this.state;
  }

  recentEvents(limit = 100) {
    return this.eventStore.recent(limit);
  }

  async close(): Promise<void> {
    if (this.lockTimer) {
      clearTimeout(this.lockTimer);
      this.lockTimer = null;
    }

    this.clearRollTimeout();

    if (this.broadcastTicker) {
      clearInterval(this.broadcastTicker);
      this.broadcastTicker = null;
    }

    this.removeDeviceListener?.();

    for (const socket of this.wss.clients) {
      socket.close();
    }

    await new Promise<void>((resolve) => {
      this.wss.close(() => resolve());
    });

    await new Promise<void>((resolve) => {
      this.httpServer.close(() => resolve());
    });

    await this.device.disconnect();
    this.eventStore.close();
  }

  private handleConnection(socket: WebSocket): void {
    this.sessions.set(socket, { playerId: null });
    this.send(socket, {
      type: "state",
      state: this.publicState()
    });

    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString()) as ClientMessage;
        this.handleMessage(socket, message);
      } catch (error) {
        this.sendError(socket, errorMessage(error));
      }
    });

    socket.on("close", () => {
      const session = this.sessions.get(socket);
      this.sessions.delete(socket);
      if (session?.playerId && !this.hasOpenSessionForPlayer(session.playerId)) {
        this.state = disconnectPlayer(this.state, session.playerId);
        this.eventStore.append("player_disconnected", {
          playerId: session.playerId
        });
        this.persistState();
        this.broadcastState();
      }
    });
  }

  private handleMessage(socket: WebSocket, message: ClientMessage): void {
    switch (message.type) {
      case "authenticate":
        void this.authenticate(socket, message.accessToken);
        break;
      case "join":
        this.join(socket, message.displayName);
        break;
      case "placeBet":
        this.placeBet(socket, message.kind, message.amount);
        break;
      case "removeBet":
        this.removeBet(socket, message.betId);
        break;
      case "requestRoll":
        void this.requestRoll(socket);
        break;
      case "rebuyChips":
        this.rebuyChips(socket);
        break;
      case "chat":
        this.chat(socket, message.message);
        break;
      default:
        this.sendError(socket, "Unsupported message type.");
    }
  }

  private async authenticate(socket: WebSocket, accessToken: string): Promise<void> {
    if (this.config.authMode !== "entra" || !this.authVerifier) {
      this.sendError(socket, "Entra authentication is not enabled.");
      return;
    }

    const session = this.sessions.get(socket);
    if (!session) {
      return;
    }

    if (session.playerId) {
      this.sendError(socket, "This connection has already joined.");
      return;
    }

    try {
      const identity = await this.authVerifier.verify(accessToken);
      const cleanName = sanitizeDisplayName(identity.displayName) || "Player";
      const user = this.eventStore.getOrCreateUserForIdentity({
        authProvider: identity.provider,
        authSubject: identity.subject,
        displayName: cleanName,
        startingBalance: this.config.startingBalance
      });

      this.connectUser(socket, user);
      this.eventStore.append("player_authenticated", {
        playerId: user.id,
        displayName: user.displayName,
        authProvider: user.authProvider
      });
      this.send(socket, { type: "authenticated", playerId: user.id });
      this.broadcastState();
    } catch (error) {
      this.sendError(socket, errorMessage(error));
    }
  }

  private join(socket: WebSocket, displayName: string): void {
    if (this.config.authMode === "entra") {
      this.sendError(socket, "Sign in before joining the table.");
      return;
    }

    const session = this.sessions.get(socket);
    if (!session) {
      return;
    }

    if (session.playerId) {
      this.sendError(socket, "This connection has already joined.");
      return;
    }

    const cleanName = sanitizeDisplayName(displayName);
    if (!cleanName) {
      this.sendError(socket, "Display name is required.");
      return;
    }

    const playerId = randomUUID();
    const joinedAt = Date.now();
    const user = this.eventStore.createLocalUser({
      id: playerId,
      displayName: cleanName,
      startingBalance: this.config.startingBalance
    });
    this.state = addPlayer(this.state, userToPlayer(user, joinedAt));
    session.playerId = playerId;

    this.eventStore.append("player_joined", {
      playerId,
      displayName: cleanName,
      startingBalance: this.config.startingBalance
    });

    this.send(socket, { type: "joined", playerId });
    this.persistState();
    this.broadcastState();
  }

  private connectUser(socket: WebSocket, user: StoredUser): void {
    const session = this.sessions.get(socket);
    if (!session) {
      return;
    }

    session.playerId = user.id;
    const existingPlayer = this.state.players[user.id];
    this.state = addPlayer(
      this.state,
      userToPlayer(
        {
          ...user,
          balance: existingPlayer?.balance ?? user.balance,
          totalBuyIns: existingPlayer?.totalBuyIns ?? user.totalBuyIns
        },
        existingPlayer?.joinedAt ?? Date.now()
      )
    );
    this.persistState();
  }

  private placeBet(socket: WebSocket, kind: BetKind, amount: number): void {
    const playerId = this.playerIdFor(socket);
    if (!playerId) {
      this.sendError(socket, "Join the table before betting.");
      return;
    }

    if (!BET_DEFINITIONS[kind]) {
      this.sendError(socket, "Unknown bet type.");
      return;
    }

    const betId = randomUUID();
    try {
      this.state = placeBet(this.state, {
        id: betId,
        playerId,
        kind,
        amount,
        createdAt: Date.now()
      });
    } catch (error) {
      this.sendError(socket, errorMessage(error));
      return;
    }

    this.eventStore.append("bet_placed", {
      betId,
      playerId,
      kind,
      amount
    });
    this.persistPlayer(playerId);
    this.persistState();
    this.broadcastState();
  }

  private removeBet(socket: WebSocket, betId: string): void {
    const playerId = this.playerIdFor(socket);
    if (!playerId) {
      this.sendError(socket, "Join the table before removing bets.");
      return;
    }

    try {
      const result = removeBet(this.state, playerId, betId);
      this.state = result.state;
      this.eventStore.append("bet_removed", {
        betId,
        playerId,
        kind: result.bet.kind,
        amount: result.bet.amount
      });
      this.persistPlayer(playerId);
      this.persistState();
      this.broadcastState();
    } catch (error) {
      this.sendError(socket, errorMessage(error));
    }
  }

  private rebuyChips(socket: WebSocket): void {
    const playerId = this.playerIdFor(socket);
    if (!playerId) {
      this.sendError(socket, "Join the table before buying chips.");
      return;
    }

    try {
      this.state = rebuyPlayer(this.state, playerId, this.config.rebuyChips);
      const player = this.state.players[playerId];
      this.eventStore.append("chips_rebought", {
        playerId,
        amount: this.config.rebuyChips,
        balance: player.balance,
        totalBuyIns: player.totalBuyIns
      });
      this.persistPlayer(playerId);
      this.persistState();
      this.broadcastState();
    } catch (error) {
      this.sendError(socket, errorMessage(error));
    }
  }

  private async requestRoll(socket: WebSocket): Promise<void> {
    const playerId = this.playerIdFor(socket);
    if (!playerId) {
      this.sendError(socket, "Join the table before rolling.");
      return;
    }

    if (playerId !== this.state.shooterId) {
      this.sendError(socket, "Only the current shooter can roll.");
      return;
    }

    if (this.state.betting.status !== "locked") {
      this.sendError(socket, "Wait for betting to lock before rolling.");
      return;
    }

    if (this.pendingRollId) {
      this.sendError(socket, "A roll is already in progress.");
      return;
    }

    this.clearRollTimeout();
    const rollId = randomUUID();
    this.pendingRollId = rollId;
    this.eventStore.append("roll_requested", {
      rollId,
      playerId,
      authorized: true
    });

    try {
      await this.device.requestRoll(rollId);
      this.state = updateDevice(this.state, this.device.getStatus());
      this.persistState();
      this.broadcastState();
    } catch (error) {
      this.pendingRollId = null;
      this.state = updateDevice(this.state, this.device.getStatus());
      this.persistState();
      this.sendError(socket, errorMessage(error));
      this.broadcastState();
    }
  }

  private chat(socket: WebSocket, message: string): void {
    const playerId = this.playerIdFor(socket);
    if (!playerId) {
      this.sendError(socket, "Join the table before chatting.");
      return;
    }

    const player = this.state.players[playerId];
    const cleanMessage = sanitizeChat(message);
    if (!cleanMessage) {
      return;
    }

    const chatMessage = {
      id: randomUUID(),
      playerId,
      displayName: player.displayName,
      message: cleanMessage,
      createdAt: Date.now()
    };

    this.state = addChatMessage(this.state, chatMessage);
    this.eventStore.append("chat", chatMessage);
    this.broadcastState();
  }

  private async handleDiceResult(result: DiceResult): Promise<void> {
    if (!this.pendingRollId || result.rollId !== this.pendingRollId) {
      return;
    }

    this.clearRollTimeout();
    this.pendingRollId = null;
    const total = result.die1 + result.die2;
    this.state = updateDevice(this.state, this.device.getStatus());

    const resolution = settleRoll(this.state, {
      rollId: result.rollId,
      die1: result.die1,
      die2: result.die2,
      total,
      rolledAt: Date.now()
    });
    this.state = resolution.state;

    this.eventStore.append("dice_result", {
      rollId: result.rollId,
      die1: result.die1,
      die2: result.die2,
      total,
      point: this.state.point,
      phase: this.state.phase
    });

    if (resolution.settlements.length > 0) {
      this.eventStore.append("payouts", {
        rollId: result.rollId,
        settlements: resolution.settlements
      });
    }

    for (const settlement of resolution.settlements) {
      this.persistPlayer(settlement.playerId);
    }
    this.persistState();

    this.openBettingWindow();
  }

  private openBettingWindow(): void {
    if (this.lockTimer) {
      clearTimeout(this.lockTimer);
      this.lockTimer = null;
    }
    this.clearRollTimeout();

    this.state = openBetting(this.state, Date.now());
    const delay = Math.max(0, (this.state.betting.closesAt ?? Date.now()) - Date.now());
    this.lockTimer = setTimeout(() => {
      this.state = lockBetting(this.state);
      this.persistState();
      this.broadcastState();
      this.startRollTimeout();
    }, delay);
    this.persistState();
    this.broadcastState();
  }

  private startRollTimeout(): void {
    this.clearRollTimeout();

    if (this.config.rollTimeoutMs <= 0 || !this.state.shooterId) {
      return;
    }

    this.rollTimeoutTimer = setTimeout(() => {
      this.handleRollTimeout();
    }, this.config.rollTimeoutMs);
  }

  private clearRollTimeout(): void {
    if (this.rollTimeoutTimer) {
      clearTimeout(this.rollTimeoutTimer);
      this.rollTimeoutTimer = null;
    }
  }

  private handleRollTimeout(): void {
    if (
      this.pendingRollId ||
      this.state.betting.status !== "locked" ||
      this.state.device.rolling
    ) {
      return;
    }

    const timedOutShooterId = this.state.shooterId;
    const timedOutShooter = timedOutShooterId
      ? this.state.players[timedOutShooterId]
      : null;
    this.state = rotateShooter(this.state);
    const nextShooterId = this.state.shooterId;
    const nextShooter = nextShooterId ? this.state.players[nextShooterId] : null;
    const message =
      nextShooter && timedOutShooterId !== nextShooterId
        ? `${timedOutShooter?.displayName ?? "Shooter"} timed out. ${nextShooter.displayName} is now shooter.`
        : `${timedOutShooter?.displayName ?? "Shooter"} timed out. Waiting for an available shooter.`;

    this.state = addTableNotice(this.state, {
      id: randomUUID(),
      type: "roll_timeout",
      message,
      playerId: nextShooterId,
      createdAt: Date.now()
    });

    this.eventStore.append("roll_timeout", {
      shooterId: timedOutShooterId,
      nextShooterId,
      phase: this.state.phase,
      point: this.state.point
    });
    this.persistState();
    this.openBettingWindow();
  }

  private playerIdFor(socket: WebSocket): string | null {
    return this.sessions.get(socket)?.playerId ?? null;
  }

  private hasOpenSessionForPlayer(playerId: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.playerId === playerId) {
        return true;
      }
    }

    return false;
  }

  private persistPlayer(playerId: string): void {
    const player = this.state.players[playerId];
    if (player) {
      this.eventStore.updateUserFromPlayer(player);
    }
  }

  private persistState(): void {
    this.eventStore.saveGameState(this.state);
  }

  private broadcastState(): void {
    const message: ServerMessage = {
      type: "state",
      state: this.publicState()
    };

    for (const socket of this.wss.clients) {
      this.send(socket, message);
    }
  }

  private publicState(): GameState & { countdownRemainingMs: number } {
    const closesAt = this.state.betting.closesAt;
    return {
      ...this.state,
      countdownRemainingMs:
        closesAt === null ? 0 : Math.max(0, closesAt - Date.now())
    };
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  private sendError(socket: WebSocket, message: string): void {
    this.send(socket, { type: "error", message });
  }
}

function sanitizeDisplayName(displayName: string): string {
  return displayName.replace(/\s+/g, " ").trim().slice(0, 32);
}

function sanitizeChat(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 240);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected server error.";
}

function createAuthVerifier(config: AppConfig): AuthVerifier | null {
  if (config.authMode !== "entra") {
    return null;
  }

  if (!config.entraAuthority || !config.entraAudience) {
    throw new Error("ENTRA_AUTHORITY and ENTRA_AUDIENCE are required when AUTH_MODE=entra.");
  }

  return new EntraJwtVerifier({
    authority: config.entraAuthority,
    audience: config.entraAudience,
    issuer: config.entraIssuer
  });
}

function userToPlayer(
  user: Pick<StoredUser, "id" | "displayName" | "balance" | "totalBuyIns">,
  joinedAt: number
) {
  return {
    id: user.id,
    displayName: user.displayName,
    balance: user.balance,
    totalBuyIns: user.totalBuyIns,
    joinedAt
  };
}

function normalizePersistedState(
  state: GameState,
  device: GameState["device"],
  bettingDurationMs: number
): GameState {
  const players = Object.fromEntries(
    Object.entries(state.players).map(([id, player]) => [
      id,
      {
        ...player,
        totalBuyIns: player.totalBuyIns ?? 0,
        connected: false
      }
    ])
  );

  return {
    ...state,
    players,
    shooterId: null,
    betting: {
      status: "open",
      durationMs: bettingDurationMs,
      closesAt: null
    },
    notices: state.notices ?? [],
    device
  };
}
