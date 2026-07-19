import { describe, expect, it } from "vitest";
import {
  addPlayer,
  createInitialGameState,
  lockBetting,
  openBetting,
  placeBet,
  rebuyPlayer,
  removeBet,
  settleRoll
} from "../craps.js";
import { BetKind, DiceRoll, GameState } from "../types.js";

const now = 1_000;

function joinedState(): GameState {
  return openBetting(
    addPlayer(createInitialGameState({ bettingDurationMs: 1000 }), {
      id: "p1",
      displayName: "Ava",
      balance: 1000,
      totalBuyIns: 0,
      joinedAt: now
    }),
    now
  );
}

function roll(total: number, rollId = `r-${total}`): DiceRoll {
  const die1 = Math.max(1, Math.min(6, total - 1));
  const die2 = total - die1;
  return {
    rollId,
    die1,
    die2,
    total,
    rolledAt: now + 1
  };
}

function exactRoll(die1: number, die2: number, rollId = `r-${die1}-${die2}`): DiceRoll {
  return {
    rollId,
    die1,
    die2,
    total: die1 + die2,
    rolledAt: now + 1
  };
}

function bet(state: GameState, kind: BetKind, amount = 10): GameState {
  return placeBet(state, {
    id: `${kind}-1`,
    playerId: "p1",
    kind,
    amount,
    createdAt: now
  });
}

describe("craps state transitions", () => {
  it("wins pass line immediately on come-out 7", () => {
    const state = bet(joinedState(), "passLine", 10);

    const result = settleRoll(lockBetting(state), roll(7));

    expect(result.state.phase).toBe("comeOut");
    expect(result.state.point).toBeNull();
    expect(result.state.bets).toHaveLength(0);
    expect(result.state.players.p1.balance).toBe(1010);
    expect(result.settlements[0]).toMatchObject({
      kind: "passLine",
      outcome: "win",
      credit: 20,
      profit: 10
    });
  });

  it("establishes a point on come-out and resolves when the point repeats", () => {
    const comeOut = bet(joinedState(), "passLine", 10);

    const pointSet = settleRoll(lockBetting(comeOut), roll(6, "r-point"));
    expect(pointSet.state.phase).toBe("point");
    expect(pointSet.state.point).toBe(6);
    expect(pointSet.state.bets).toHaveLength(1);
    expect(pointSet.state.players.p1.balance).toBe(990);

    const madePoint = settleRoll(lockBetting(pointSet.state), roll(6, "r-made"));
    expect(madePoint.state.phase).toBe("comeOut");
    expect(madePoint.state.point).toBeNull();
    expect(madePoint.state.players.p1.balance).toBe(1010);
    expect(madePoint.settlements[0].outcome).toBe("win");
  });

  it("pushes don't pass on barred 12 during come-out", () => {
    const state = bet(joinedState(), "dontPass", 10);

    const result = settleRoll(lockBetting(state), roll(12));

    expect(result.state.players.p1.balance).toBe(1000);
    expect(result.state.bets).toHaveLength(0);
    expect(result.settlements[0]).toMatchObject({
      outcome: "push",
      credit: 10,
      profit: 0
    });
  });

  it("moves come bets to a come point before later resolution", () => {
    const tablePoint = settleRoll(lockBetting(bet(joinedState(), "passLine", 10)), roll(5));
    const withCome = openBetting(tablePoint.state, now + 10);
    const comeBet = bet(withCome, "come", 10);

    const moved = settleRoll(lockBetting(comeBet), roll(8, "r-come-point"));
    expect(moved.state.bets.find((active) => active.kind === "come")?.point).toBe(8);
    expect(moved.settlements).toContainEqual(
      expect.objectContaining({ kind: "come", outcome: "moveToPoint" })
    );

    const won = settleRoll(lockBetting(moved.state), roll(8, "r-come-win"));
    expect(won.state.players.p1.balance).toBe(1000);
    expect(won.state.bets.some((active) => active.kind === "come")).toBe(false);
  });

  it("combines added bets on the same player spot", () => {
    const first = bet(joinedState(), "field", 10);
    const combined = placeBet(first, {
      id: "field-2",
      playerId: "p1",
      kind: "field",
      amount: 15,
      createdAt: now + 1
    });

    expect(combined.bets).toHaveLength(1);
    expect(combined.bets[0]).toMatchObject({
      id: "field-1",
      kind: "field",
      amount: 25
    });
    expect(combined.players.p1.balance).toBe(975);
  });

  it("does not combine new come bets with moved come-point bets", () => {
    const tablePoint = settleRoll(lockBetting(bet(joinedState(), "passLine", 10)), roll(5));
    const comeBet = bet(openBetting(tablePoint.state, now + 10), "come", 10);
    const moved = settleRoll(lockBetting(comeBet), roll(8, "r-come-point"));
    const nextCome = placeBet(openBetting(moved.state, now + 20), {
      id: "come-2",
      playerId: "p1",
      kind: "come",
      amount: 5,
      createdAt: now + 21
    });

    expect(nextCome.bets.filter((active) => active.kind === "come")).toHaveLength(2);
    expect(nextCome.bets).toContainEqual(
      expect.objectContaining({ kind: "come", point: 8, amount: 10 })
    );
    expect(nextCome.bets).toContainEqual(
      expect.objectContaining({ kind: "come", point: null, amount: 5 })
    );
  });

  it("settles field as a one-roll bet with triple payout on 12", () => {
    const state = bet(joinedState(), "field", 10);

    const result = settleRoll(lockBetting(state), roll(12));

    expect(result.state.players.p1.balance).toBe(1030);
    expect(result.state.bets).toHaveLength(0);
    expect(result.settlements[0]).toMatchObject({
      kind: "field",
      outcome: "win",
      credit: 40,
      profit: 30
    });
  });

  it("settles one-roll proposition bets", () => {
    const state = bet(joinedState(), "anySeven", 5);

    const result = settleRoll(lockBetting(state), exactRoll(3, 4));

    expect(result.state.players.p1.balance).toBe(1020);
    expect(result.state.bets).toHaveLength(0);
    expect(result.settlements[0]).toMatchObject({
      kind: "anySeven",
      outcome: "win",
      credit: 25,
      profit: 20
    });
  });

  it("collects hardway winnings and keeps hardways working", () => {
    const state = bet(joinedState(), "hard6", 5);

    const result = settleRoll(lockBetting(state), exactRoll(3, 3));

    expect(result.state.players.p1.balance).toBe(1040);
    expect(result.state.bets.find((active) => active.kind === "hard6")).toBeTruthy();
    expect(result.settlements[0]).toMatchObject({
      kind: "hard6",
      outcome: "collect",
      credit: 45,
      profit: 45
    });
  });

  it("loses hardways on easy rolls", () => {
    const state = bet(joinedState(), "hard6", 5);

    const result = settleRoll(lockBetting(state), exactRoll(1, 5));

    expect(result.state.players.p1.balance).toBe(995);
    expect(result.state.bets.some((active) => active.kind === "hard6")).toBe(false);
    expect(result.settlements[0]).toMatchObject({
      kind: "hard6",
      outcome: "lose"
    });
  });

  it("collects place bet winnings and keeps the place bet working while point is on", () => {
    const tablePoint = settleRoll(lockBetting(bet(joinedState(), "passLine", 10)), roll(5));
    const withPlace = placeBet(openBetting(tablePoint.state, now + 10), {
      id: "place6-1",
      playerId: "p1",
      kind: "place6",
      amount: 12,
      createdAt: now + 11
    });

    const result = settleRoll(lockBetting(withPlace), roll(6));

    expect(result.state.players.p1.balance).toBe(992);
    expect(result.state.bets.find((active) => active.kind === "place6")).toBeTruthy();
    expect(result.settlements).toContainEqual(
      expect.objectContaining({
        kind: "place6",
        outcome: "collect",
        credit: 14,
        profit: 14
      })
    );
  });

  it("loses place bets on seven-out and rotates the shooter", () => {
    const withTwoPlayers = addPlayer(joinedState(), {
      id: "p2",
      displayName: "Ben",
      balance: 1000,
      totalBuyIns: 0,
      joinedAt: now + 1
    });
    const tablePoint = settleRoll(lockBetting(bet(withTwoPlayers, "passLine", 10)), roll(4));
    const withPlace = placeBet(openBetting(tablePoint.state, now + 10), {
      id: "place10-1",
      playerId: "p1",
      kind: "place10",
      amount: 10,
      createdAt: now + 11
    });

    const result = settleRoll(lockBetting(withPlace), roll(7));

    expect(result.sevenOut).toBe(true);
    expect(result.state.shooterId).toBe("p2");
    expect(result.state.bets).toHaveLength(0);
    expect(result.settlements).toContainEqual(
      expect.objectContaining({ kind: "place10", outcome: "lose" })
    );
  });

  it("collects lay bet winnings on seven and keeps the lay bet working", () => {
    const tablePoint = settleRoll(lockBetting(bet(joinedState(), "passLine", 10)), roll(5));
    const withLay = placeBet(openBetting(tablePoint.state, now + 10), {
      id: "lay4-1",
      playerId: "p1",
      kind: "lay4",
      amount: 20,
      createdAt: now + 11
    });

    const result = settleRoll(lockBetting(withLay), roll(7));

    expect(result.state.players.p1.balance).toBe(979);
    expect(result.state.bets.find((active) => active.kind === "lay4")).toBeTruthy();
    expect(result.settlements).toContainEqual(
      expect.objectContaining({
        kind: "lay4",
        outcome: "collect",
        credit: 9,
        profit: 9
      })
    );
  });

  it("requires flat bets before placing pass and don't pass odds", () => {
    const pointSet = settleRoll(lockBetting(bet(joinedState(), "passLine", 10)), roll(5));
    const pointState = openBetting(pointSet.state, now + 10);

    expect(() =>
      placeBet(pointState, {
        id: "dp-odds-without-flat",
        playerId: "p1",
        kind: "dontPassOdds",
        amount: 10,
        createdAt: now + 11
      })
    ).toThrow(/requires a Don't Pass bet/);

    const withPassOdds = placeBet(pointState, {
      id: "pass-odds",
      playerId: "p1",
      kind: "passOdds",
      amount: 10,
      createdAt: now + 12
    });

    expect(withPassOdds.bets).toContainEqual(
      expect.objectContaining({ kind: "passOdds", point: 5, amount: 10 })
    );
  });

  it("settles pass odds at true odds and rounds down", () => {
    const pointSet = settleRoll(lockBetting(bet(joinedState(), "passLine", 10)), roll(5));
    const withOdds = placeBet(openBetting(pointSet.state, now + 10), {
      id: "pass-odds",
      playerId: "p1",
      kind: "passOdds",
      amount: 5,
      createdAt: now + 11
    });

    const result = settleRoll(lockBetting(withOdds), roll(5));

    expect(result.settlements).toContainEqual(
      expect.objectContaining({
        kind: "passOdds",
        outcome: "win",
        credit: 12,
        profit: 7
      })
    );
  });

  it("settles don't pass odds without vig", () => {
    const comeOut = bet(joinedState(), "dontPass", 10);
    const pointSet = settleRoll(lockBetting(comeOut), roll(4));
    const withOdds = placeBet(openBetting(pointSet.state, now + 10), {
      id: "dont-pass-odds",
      playerId: "p1",
      kind: "dontPassOdds",
      amount: 9,
      createdAt: now + 11
    });

    const result = settleRoll(lockBetting(withOdds), roll(7));

    expect(result.settlements).toContainEqual(
      expect.objectContaining({
        kind: "dontPassOdds",
        outcome: "win",
        credit: 13,
        profit: 4
      })
    );
  });

  it("loses lay bets when the laid number rolls", () => {
    const tablePoint = settleRoll(lockBetting(bet(joinedState(), "passLine", 10)), roll(5));
    const withLay = placeBet(openBetting(tablePoint.state, now + 10), {
      id: "lay4-1",
      playerId: "p1",
      kind: "lay4",
      amount: 20,
      createdAt: now + 11
    });

    const result = settleRoll(lockBetting(withLay), roll(4));

    expect(result.state.players.p1.balance).toBe(970);
    expect(result.state.bets.some((active) => active.kind === "lay4")).toBe(false);
    expect(result.settlements).toContainEqual(
      expect.objectContaining({ kind: "lay4", outcome: "lose" })
    );
  });

  it("rejects phase-ineligible bets but accepts odd amounts with rounded-down payouts", () => {
    const state = joinedState();

    expect(() => bet(state, "come", 10)).toThrow(/not available/);

    const tablePoint = settleRoll(lockBetting(bet(state, "passLine", 10)), roll(9));
    const withPlace6 = placeBet(openBetting(tablePoint.state, now + 10), {
      id: "place6-odd",
      playerId: "p1",
      kind: "place6",
      amount: 5,
      createdAt: now + 10
    });

    const placeResult = settleRoll(lockBetting(withPlace6), roll(6));
    expect(placeResult.state.players.p1.balance).toBe(990);
    expect(placeResult.settlements).toContainEqual(
      expect.objectContaining({
        kind: "place6",
        outcome: "collect",
        credit: 5,
        profit: 5
      })
    );

    const withLay5 = placeBet(openBetting(tablePoint.state, now + 10), {
      id: "lay5-odd",
      playerId: "p1",
      kind: "lay5",
      amount: 5,
      createdAt: now + 10
    });

    const layResult = settleRoll(lockBetting(withLay5), roll(7));
    expect(layResult.settlements).toContainEqual(
      expect.objectContaining({
        kind: "lay5",
        outcome: "collect",
        credit: 2,
        profit: 2
      })
    );
  });

  it("removes refundable bets while betting is open", () => {
    const state = bet(joinedState(), "field", 10);
    const betId = state.bets[0].id;

    const result = removeBet(state, "p1", betId);

    expect(result.bet.kind).toBe("field");
    expect(result.state.bets).toHaveLength(0);
    expect(result.state.players.p1.balance).toBe(1000);
  });

  it("does not remove established pass line contract bets", () => {
    const pointSet = settleRoll(lockBetting(bet(joinedState(), "passLine", 10)), roll(6));
    const state = openBetting(pointSet.state, now + 10);
    const betId = state.bets[0].id;

    expect(() => removeBet(state, "p1", betId)).toThrow(/contract bet/);
  });

  it("adds rebuy chips and tracks cumulative play buy-ins", () => {
    const state = rebuyPlayer(joinedState(), "p1", 2000);

    expect(state.players.p1.balance).toBe(3000);
    expect(state.players.p1.totalBuyIns).toBe(2000);
  });
});
