import {
  Bet,
  BetDefinition,
  BetKind,
  ChatMessage,
  DeviceSnapshot,
  DiceRoll,
  GameState,
  PlayerState,
  POINT_NUMBERS,
  PointNumber,
  RollRecord,
  RollResolution,
  Settlement,
  TableNotice,
  TablePhase
} from "./types.js";

const pointSet = new Set<number>(POINT_NUMBERS);

export const BET_DEFINITIONS: Record<BetKind, BetDefinition> = {
  passLine: {
    kind: "passLine",
    label: "Pass Line",
    allowedPhases: ["comeOut"],
    point: null,
  },
  dontPass: {
    kind: "dontPass",
    label: "Don't Pass",
    allowedPhases: ["comeOut"],
    point: null,
  },
  passOdds: {
    kind: "passOdds",
    label: "Pass Odds",
    allowedPhases: ["point"],
    point: null,
  },
  dontPassOdds: {
    kind: "dontPassOdds",
    label: "Don't Pass Odds",
    allowedPhases: ["point"],
    point: null,
  },
  come: {
    kind: "come",
    label: "Come",
    allowedPhases: ["point"],
    point: null,
  },
  dontCome: {
    kind: "dontCome",
    label: "Don't Come",
    allowedPhases: ["point"],
    point: null,
  },
  field: {
    kind: "field",
    label: "Field",
    allowedPhases: ["comeOut", "point"],
    point: null,
  },
  place4: {
    kind: "place4",
    label: "Place 4",
    allowedPhases: ["point"],
    point: 4,
  },
  place5: {
    kind: "place5",
    label: "Place 5",
    allowedPhases: ["point"],
    point: 5,
  },
  place6: {
    kind: "place6",
    label: "Place 6",
    allowedPhases: ["point"],
    point: 6,
  },
  place8: {
    kind: "place8",
    label: "Place 8",
    allowedPhases: ["point"],
    point: 8,
  },
  place9: {
    kind: "place9",
    label: "Place 9",
    allowedPhases: ["point"],
    point: 9,
  },
  place10: {
    kind: "place10",
    label: "Place 10",
    allowedPhases: ["point"],
    point: 10,
  },
  lay4: {
    kind: "lay4",
    label: "Lay 4",
    allowedPhases: ["point"],
    point: 4,
  },
  lay5: {
    kind: "lay5",
    label: "Lay 5",
    allowedPhases: ["point"],
    point: 5,
  },
  lay6: {
    kind: "lay6",
    label: "Lay 6",
    allowedPhases: ["point"],
    point: 6,
  },
  lay8: {
    kind: "lay8",
    label: "Lay 8",
    allowedPhases: ["point"],
    point: 8,
  },
  lay9: {
    kind: "lay9",
    label: "Lay 9",
    allowedPhases: ["point"],
    point: 9,
  },
  lay10: {
    kind: "lay10",
    label: "Lay 10",
    allowedPhases: ["point"],
    point: 10,
  },
  anySeven: {
    kind: "anySeven",
    label: "Any Seven",
    allowedPhases: ["comeOut", "point"],
    point: null,
  },
  anyCraps: {
    kind: "anyCraps",
    label: "Any Craps",
    allowedPhases: ["comeOut", "point"],
    point: null,
  },
  aces: {
    kind: "aces",
    label: "Aces",
    allowedPhases: ["comeOut", "point"],
    point: null,
  },
  aceDeuce: {
    kind: "aceDeuce",
    label: "Ace-Deuce",
    allowedPhases: ["comeOut", "point"],
    point: null,
  },
  yo: {
    kind: "yo",
    label: "Yo",
    allowedPhases: ["comeOut", "point"],
    point: null,
  },
  boxcars: {
    kind: "boxcars",
    label: "Boxcars",
    allowedPhases: ["comeOut", "point"],
    point: null,
  },
  hard4: {
    kind: "hard4",
    label: "Hard 4",
    allowedPhases: ["comeOut", "point"],
    point: 4,
  },
  hard6: {
    kind: "hard6",
    label: "Hard 6",
    allowedPhases: ["comeOut", "point"],
    point: 6,
  },
  hard8: {
    kind: "hard8",
    label: "Hard 8",
    allowedPhases: ["comeOut", "point"],
    point: 8,
  },
  hard10: {
    kind: "hard10",
    label: "Hard 10",
    allowedPhases: ["comeOut", "point"],
    point: 10,
  }
};

export const BET_KINDS = Object.keys(BET_DEFINITIONS) as BetKind[];

export const DEFAULT_DEVICE: DeviceSnapshot = {
  kind: "simulated",
  label: "Simulated",
  connected: false,
  rolling: false,
  lastError: null
};

export function createInitialGameState(options?: {
  bettingDurationMs?: number;
  device?: DeviceSnapshot;
}): GameState {
  return {
    players: {},
    shooterId: null,
    phase: "comeOut",
    point: null,
    bets: [],
    betting: {
      status: "open",
      durationMs: options?.bettingDurationMs ?? 10_000,
      closesAt: null
    },
    rollNumber: 0,
    lastRoll: null,
    history: [],
    settlementFeed: [],
    notices: [],
    chat: [],
    device: options?.device ?? DEFAULT_DEVICE
  };
}

export function openBetting(state: GameState, now: number): GameState {
  return {
    ...state,
    betting: {
      ...state.betting,
      status: "open",
      closesAt: now + state.betting.durationMs
    }
  };
}

export function lockBetting(state: GameState): GameState {
  return {
    ...state,
    betting: {
      ...state.betting,
      status: "locked",
      closesAt: null
    }
  };
}

export function updateDevice(state: GameState, device: DeviceSnapshot): GameState {
  return {
    ...state,
    device
  };
}

export function addChatMessage(state: GameState, message: ChatMessage): GameState {
  return {
    ...state,
    chat: [...state.chat, message].slice(-80)
  };
}

export function addPlayer(
  state: GameState,
  player: Omit<PlayerState, "connected">
): GameState {
  const nextPlayers = {
    ...state.players,
    [player.id]: {
      ...player,
      connected: true
    }
  };

  return {
    ...state,
    players: nextPlayers,
    shooterId: state.shooterId ?? player.id
  };
}

export function disconnectPlayer(state: GameState, playerId: string): GameState {
  if (!state.players[playerId]) {
    return state;
  }

  const nextPlayers = {
    ...state.players,
    [playerId]: {
      ...state.players[playerId],
      connected: false
    }
  };

  return {
    ...state,
    players: nextPlayers,
    shooterId:
      state.shooterId === playerId
        ? chooseNextShooter(nextPlayers, playerId)
        : state.shooterId
  };
}

export function validateBet(
  state: GameState,
  playerId: string,
  kind: BetKind,
  amount: number
): string | null {
  const player = state.players[playerId];
  const definition = BET_DEFINITIONS[kind];

  if (!player || !player.connected) {
    return "Join the table before betting.";
  }

  if (!definition) {
    return "Unknown bet type.";
  }

  if (state.betting.status !== "open") {
    return "Betting is locked for the next roll.";
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    return "Bet amount must be a positive whole number.";
  }

  if (amount > player.balance) {
    return "Insufficient virtual chips.";
  }

  if (!definition.allowedPhases.includes(state.phase)) {
    return `${definition.label} is not available in the current table phase.`;
  }

  if (kind === "passOdds" || kind === "dontPassOdds") {
    const baseKind = kind === "passOdds" ? "passLine" : "dontPass";
    if (state.point === null) {
      return `${definition.label} requires an established point.`;
    }
    if (
      !state.bets.some(
        (bet) =>
          bet.playerId === playerId &&
          bet.kind === baseKind &&
          bet.point === null
      )
    ) {
      return `${definition.label} requires a ${BET_DEFINITIONS[baseKind].label} bet.`;
    }
  }

  return null;
}

export function placeBet(
  state: GameState,
  bet: Omit<Bet, "point">
): GameState {
  const error = validateBet(state, bet.playerId, bet.kind, bet.amount);
  if (error) {
    throw new Error(error);
  }

  const definition = BET_DEFINITIONS[bet.kind];
  const player = state.players[bet.playerId];
  const point =
    bet.kind === "passOdds" || bet.kind === "dontPassOdds"
      ? state.point
      : definition.point;
  const existingBet = state.bets.find(
    (candidate) =>
      candidate.playerId === bet.playerId &&
      candidate.kind === bet.kind &&
      candidate.point === point
  );
  const nextBets = existingBet
    ? state.bets.map((candidate) =>
        candidate.id === existingBet.id
          ? {
              ...candidate,
              amount: candidate.amount + bet.amount
            }
          : candidate
      )
    : [
        ...state.bets,
        {
          ...bet,
          point
        }
      ];

  return {
    ...state,
    players: {
      ...state.players,
      [bet.playerId]: {
        ...player,
        balance: player.balance - bet.amount
      }
    },
    bets: nextBets
  };
}

export function removeBet(
  state: GameState,
  playerId: string,
  betId: string
): { state: GameState; bet: Bet } {
  const player = state.players[playerId];
  const bet = state.bets.find((candidate) => candidate.id === betId);

  if (!player || !player.connected) {
    throw new Error("Join the table before removing bets.");
  }

  if (state.betting.status !== "open") {
    throw new Error("Betting is locked for the next roll.");
  }

  if (!bet || bet.playerId !== playerId) {
    throw new Error("Bet was not found for this player.");
  }

  if (!isBetRemovable(state, bet)) {
    throw new Error(`${BET_DEFINITIONS[bet.kind].label} is a contract bet and cannot be removed now.`);
  }

  return {
    bet,
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          balance: player.balance + bet.amount
        }
      },
      bets: state.bets.filter((candidate) => candidate.id !== betId)
    }
  };
}

export function rebuyPlayer(
  state: GameState,
  playerId: string,
  amount: number
): GameState {
  const player = state.players[playerId];

  if (!player || !player.connected) {
    throw new Error("Join the table before buying chips.");
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Chip buy amount must be a positive whole number.");
  }

  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        balance: player.balance + amount,
        totalBuyIns: player.totalBuyIns + amount
      }
    }
  };
}

export function addTableNotice(state: GameState, notice: TableNotice): GameState {
  return {
    ...state,
    notices: [...state.notices, notice].slice(-20)
  };
}

export function rotateShooter(state: GameState): GameState {
  return {
    ...state,
    shooterId: chooseNextShooter(state.players, state.shooterId)
  };
}

export function isBetRemovable(state: GameState, bet: Bet): boolean {
  if (bet.kind === "passLine" && state.phase === "point") {
    return false;
  }

  if (bet.kind === "dontPass" && state.phase === "point") {
    return false;
  }

  if (bet.kind === "come" && bet.point !== null) {
    return false;
  }

  return true;
}

export function settleRoll(
  state: GameState,
  roll: DiceRoll
): RollResolution {
  const total = roll.total;
  const phaseBefore = state.phase;
  const pointBefore = state.point;
  const settlements: Settlement[] = [];
  const players = clonePlayers(state.players);
  const remainingBets: Bet[] = [];

  for (const bet of state.bets) {
    const result = settleBet(bet, roll, phaseBefore, pointBefore);

    if (result.kind === "remain") {
      remainingBets.push(bet);
      continue;
    }

    if (result.kind === "move") {
      remainingBets.push({
        ...bet,
        point: result.point
      });
      settlements.push({
        betId: bet.id,
        playerId: bet.playerId,
        kind: bet.kind,
        outcome: "moveToPoint",
        credit: 0,
        profit: 0,
        description: `${BET_DEFINITIONS[bet.kind].label} moved to ${result.point}`
      });
      continue;
    }

    const player = players[bet.playerId];
    if (player && result.credit > 0) {
      player.balance += result.credit;
    }

    settlements.push({
      betId: bet.id,
      playerId: bet.playerId,
      kind: bet.kind,
      outcome: result.outcome,
      credit: result.credit,
      profit: result.profit,
      description: result.description
    });

    if (result.keepBet) {
      remainingBets.push(bet);
    }
  }

  const nextTable = advanceTable(phaseBefore, pointBefore, total);
  const sevenOut =
    phaseBefore === "point" && total === 7 && pointBefore !== null;
  const shooterId = sevenOut
    ? chooseNextShooter(players, state.shooterId)
    : state.shooterId;

  const record: RollRecord = {
    ...roll,
    shooterId: state.shooterId,
    phaseBefore,
    pointBefore,
    phaseAfter: nextTable.phase,
    pointAfter: nextTable.point
  };
  const settlementFeed = settlements.map((settlement) => ({
    ...settlement,
    id: `${roll.rollId}:${settlement.betId}:${settlement.outcome}`,
    rollId: roll.rollId,
    displayName: players[settlement.playerId]?.displayName ?? "Player",
    createdAt: roll.rolledAt
  }));

  return {
    state: {
      ...state,
      players,
      shooterId,
      phase: nextTable.phase,
      point: nextTable.point,
      bets: remainingBets,
      rollNumber: state.rollNumber + 1,
      lastRoll: record,
      history: [...state.history, record].slice(-20),
      settlementFeed: [...state.settlementFeed, ...settlementFeed].slice(-80)
    },
    settlements,
    sevenOut
  };
}

export function isPointNumber(total: number): total is PointNumber {
  return pointSet.has(total);
}

export function chooseNextShooter(
  players: Record<string, PlayerState>,
  currentShooterId: string | null
): string | null {
  const connected = Object.values(players)
    .filter((player) => player.connected)
    .sort((a, b) => a.joinedAt - b.joinedAt);

  if (connected.length === 0) {
    return null;
  }

  if (!currentShooterId) {
    return connected[0].id;
  }

  const index = connected.findIndex((player) => player.id === currentShooterId);
  if (index === -1) {
    return connected[0].id;
  }

  return connected[(index + 1) % connected.length].id;
}

function settleBet(
  bet: Bet,
  roll: DiceRoll,
  phaseBefore: TablePhase,
  pointBefore: PointNumber | null
):
  | { kind: "remain" }
  | { kind: "move"; point: PointNumber }
  | {
      kind: "settle";
      outcome: "win" | "lose" | "push" | "collect";
      credit: number;
      profit: number;
      description: string;
      keepBet: boolean;
    } {
  const total = roll.total;

  switch (bet.kind) {
    case "passLine":
      return settlePassLine(bet, total, phaseBefore, pointBefore);
    case "dontPass":
      return settleDontPass(bet, total, phaseBefore, pointBefore);
    case "passOdds":
      return settlePassOdds(bet, total, phaseBefore);
    case "dontPassOdds":
      return settleDontPassOdds(bet, total, phaseBefore);
    case "come":
      return settleCome(bet, total);
    case "dontCome":
      return settleDontCome(bet, total);
    case "field":
      return settleField(bet, total);
    case "place4":
    case "place5":
    case "place6":
    case "place8":
    case "place9":
    case "place10":
      return settlePlace(bet, total, phaseBefore);
    case "lay4":
    case "lay5":
    case "lay6":
    case "lay8":
    case "lay9":
    case "lay10":
      return settleLay(bet, total, phaseBefore);
    case "anySeven":
      return settleOneRollProp(bet, total === 7, 4, "Any Seven wins");
    case "anyCraps":
      return settleOneRollProp(
        bet,
        total === 2 || total === 3 || total === 12,
        7,
        "Any Craps wins"
      );
    case "aces":
      return settleOneRollProp(bet, total === 2, 30, "Aces wins");
    case "aceDeuce":
      return settleOneRollProp(bet, total === 3, 15, "Ace-Deuce wins");
    case "yo":
      return settleOneRollProp(bet, total === 11, 15, "Yo wins");
    case "boxcars":
      return settleOneRollProp(bet, total === 12, 30, "Boxcars wins");
    case "hard4":
    case "hard6":
    case "hard8":
    case "hard10":
      return settleHardway(bet, roll);
    default:
      return { kind: "remain" };
  }
}

function settlePassLine(
  bet: Bet,
  total: number,
  phaseBefore: TablePhase,
  pointBefore: PointNumber | null
): ReturnType<typeof settleBet> {
  if (phaseBefore === "comeOut") {
    if (total === 7 || total === 11) {
      return evenMoneyWin(bet, "Pass Line wins on the come-out roll");
    }
    if (total === 2 || total === 3 || total === 12) {
      return lose("Pass Line loses on come-out craps");
    }
    return { kind: "remain" };
  }

  if (pointBefore !== null && total === pointBefore) {
    return evenMoneyWin(bet, "Pass Line wins when the point repeats");
  }
  if (total === 7) {
    return lose("Pass Line loses on seven-out");
  }
  return { kind: "remain" };
}

function settleDontPass(
  bet: Bet,
  total: number,
  phaseBefore: TablePhase,
  pointBefore: PointNumber | null
): ReturnType<typeof settleBet> {
  if (phaseBefore === "comeOut") {
    if (total === 2 || total === 3) {
      return evenMoneyWin(bet, "Don't Pass wins on come-out craps");
    }
    if (total === 12) {
      return push(bet, "Don't Pass pushes on barred 12");
    }
    if (total === 7 || total === 11) {
      return lose("Don't Pass loses on the come-out roll");
    }
    return { kind: "remain" };
  }

  if (pointBefore !== null && total === pointBefore) {
    return lose("Don't Pass loses when the point repeats");
  }
  if (total === 7) {
    return evenMoneyWin(bet, "Don't Pass wins on seven-out");
  }
  return { kind: "remain" };
}

function settlePassOdds(
  bet: Bet,
  total: number,
  phaseBefore: TablePhase
): ReturnType<typeof settleBet> {
  if (phaseBefore === "comeOut" || bet.point === null) {
    return { kind: "remain" };
  }

  if (total === bet.point) {
    const profit = passOddsProfit(bet.point, bet.amount);
    return {
      kind: "settle",
      outcome: "win",
      credit: bet.amount + profit,
      profit,
      description: `${BET_DEFINITIONS[bet.kind].label} wins`,
      keepBet: false
    };
  }

  if (total === 7) {
    return lose(`${BET_DEFINITIONS[bet.kind].label} loses on seven-out`);
  }

  return { kind: "remain" };
}

function settleDontPassOdds(
  bet: Bet,
  total: number,
  phaseBefore: TablePhase
): ReturnType<typeof settleBet> {
  if (phaseBefore === "comeOut" || bet.point === null) {
    return { kind: "remain" };
  }

  if (total === 7) {
    const profit = grossLayProfit(bet.point, bet.amount);
    return {
      kind: "settle",
      outcome: "win",
      credit: bet.amount + profit,
      profit,
      description: `${BET_DEFINITIONS[bet.kind].label} wins on seven-out`,
      keepBet: false
    };
  }

  if (total === bet.point) {
    return lose(`${BET_DEFINITIONS[bet.kind].label} loses when the point repeats`);
  }

  return { kind: "remain" };
}

function settleCome(bet: Bet, total: number): ReturnType<typeof settleBet> {
  if (bet.point === null) {
    if (total === 7 || total === 11) {
      return evenMoneyWin(bet, "Come wins on 7 or 11");
    }
    if (total === 2 || total === 3 || total === 12) {
      return lose("Come loses on 2, 3 or 12");
    }
    if (isPointNumber(total)) {
      return { kind: "move", point: total };
    }
  } else {
    if (total === bet.point) {
      return evenMoneyWin(bet, `Come ${bet.point} wins`);
    }
    if (total === 7) {
      return lose(`Come ${bet.point} loses on 7`);
    }
  }
  return { kind: "remain" };
}

function settleDontCome(bet: Bet, total: number): ReturnType<typeof settleBet> {
  if (bet.point === null) {
    if (total === 2 || total === 3) {
      return evenMoneyWin(bet, "Don't Come wins on 2 or 3");
    }
    if (total === 12) {
      return push(bet, "Don't Come pushes on barred 12");
    }
    if (total === 7 || total === 11) {
      return lose("Don't Come loses on 7 or 11");
    }
    if (isPointNumber(total)) {
      return { kind: "move", point: total };
    }
  } else {
    if (total === bet.point) {
      return lose(`Don't Come ${bet.point} loses`);
    }
    if (total === 7) {
      return evenMoneyWin(bet, `Don't Come ${bet.point} wins on 7`);
    }
  }
  return { kind: "remain" };
}

function settleField(bet: Bet, total: number): ReturnType<typeof settleBet> {
  if (total === 2) {
    return multiplierWin(bet, 2, "Field wins double on 2");
  }
  if (total === 12) {
    return multiplierWin(bet, 3, "Field wins triple on 12");
  }
  if ([3, 4, 9, 10, 11].includes(total)) {
    return evenMoneyWin(bet, "Field wins");
  }
  return lose("Field loses");
}

function settlePlace(
  bet: Bet,
  total: number,
  phaseBefore: TablePhase
): ReturnType<typeof settleBet> {
  if (phaseBefore === "comeOut") {
    return { kind: "remain" };
  }

  if (total === 7) {
    return lose(`${BET_DEFINITIONS[bet.kind].label} loses on 7`);
  }

  if (bet.point !== total) {
    return { kind: "remain" };
  }

  const profit = placeProfit(bet.point, bet.amount);
  return {
    kind: "settle",
    outcome: "collect",
    credit: profit,
    profit,
    description: `${BET_DEFINITIONS[bet.kind].label} collects`,
    keepBet: true
  };
}

function settleLay(
  bet: Bet,
  total: number,
  phaseBefore: TablePhase
): ReturnType<typeof settleBet> {
  if (phaseBefore === "comeOut") {
    return { kind: "remain" };
  }

  if (total === bet.point) {
    return lose(`${BET_DEFINITIONS[bet.kind].label} loses when ${total} rolls`);
  }

  if (total !== 7 || bet.point === null) {
    return { kind: "remain" };
  }

  const profit = layProfit(bet.point, bet.amount);
  return {
    kind: "settle",
    outcome: "collect",
    credit: profit,
    profit,
    description: `${BET_DEFINITIONS[bet.kind].label} collects on 7 after 5% win vig`,
    keepBet: true
  };
}

function settleOneRollProp(
  bet: Bet,
  didWin: boolean,
  multiplier: number,
  description: string
): ReturnType<typeof settleBet> {
  if (didWin) {
    return multiplierWin(bet, multiplier, description);
  }
  return lose(`${BET_DEFINITIONS[bet.kind].label} loses`);
}

function settleHardway(bet: Bet, roll: DiceRoll): ReturnType<typeof settleBet> {
  const total = roll.total;
  if (total === 7) {
    return lose(`${BET_DEFINITIONS[bet.kind].label} loses on 7`);
  }

  if (bet.point !== total || bet.point === null) {
    return { kind: "remain" };
  }

  if (roll.die1 !== roll.die2) {
    return lose(`${BET_DEFINITIONS[bet.kind].label} loses easy`);
  }

  const multiplier = bet.point === 4 || bet.point === 10 ? 7 : 9;
  const profit = bet.amount * multiplier;
  return {
    kind: "settle",
    outcome: "collect",
    credit: profit,
    profit,
    description: `${BET_DEFINITIONS[bet.kind].label} collects`,
    keepBet: true
  };
}

function advanceTable(
  phase: TablePhase,
  point: PointNumber | null,
  total: number
): { phase: TablePhase; point: PointNumber | null } {
  if (phase === "comeOut") {
    if (isPointNumber(total)) {
      return { phase: "point", point: total };
    }
    return { phase: "comeOut", point: null };
  }

  if (total === 7 || total === point) {
    return { phase: "comeOut", point: null };
  }

  return { phase, point };
}

function evenMoneyWin(
  bet: Bet,
  description: string
): Extract<ReturnType<typeof settleBet>, { kind: "settle" }> {
  return {
    kind: "settle",
    outcome: "win",
    credit: bet.amount * 2,
    profit: bet.amount,
    description,
    keepBet: false
  };
}

function multiplierWin(
  bet: Bet,
  multiplier: number,
  description: string
): Extract<ReturnType<typeof settleBet>, { kind: "settle" }> {
  const profit = bet.amount * multiplier;
  return {
    kind: "settle",
    outcome: "win",
    credit: bet.amount + profit,
    profit,
    description,
    keepBet: false
  };
}

function push(
  bet: Bet,
  description: string
): Extract<ReturnType<typeof settleBet>, { kind: "settle" }> {
  return {
    kind: "settle",
    outcome: "push",
    credit: bet.amount,
    profit: 0,
    description,
    keepBet: false
  };
}

function lose(
  description: string
): Extract<ReturnType<typeof settleBet>, { kind: "settle" }> {
  return {
    kind: "settle",
    outcome: "lose",
    credit: 0,
    profit: 0,
    description,
    keepBet: false
  };
}

function placeProfit(point: PointNumber, amount: number): number {
  switch (point) {
    case 4:
    case 10:
      return Math.floor((amount / 5) * 9);
    case 5:
    case 9:
      return Math.floor((amount / 5) * 7);
    case 6:
    case 8:
      return Math.floor((amount / 6) * 7);
  }
}

function passOddsProfit(point: PointNumber, amount: number): number {
  switch (point) {
    case 4:
    case 10:
      return amount * 2;
    case 5:
    case 9:
      return Math.floor((amount / 2) * 3);
    case 6:
    case 8:
      return Math.floor((amount / 5) * 6);
  }
}

function layProfit(point: PointNumber, amount: number): number {
  const grossProfit = grossLayProfit(point, amount);
  return Math.max(0, grossProfit - winningVig(grossProfit));
}

function grossLayProfit(point: PointNumber, amount: number): number {
  switch (point) {
    case 4:
    case 10:
      return Math.floor(amount / 2);
    case 5:
    case 9:
      return Math.floor((amount / 3) * 2);
    case 6:
    case 8:
      return Math.floor((amount / 6) * 5);
  }
}

function winningVig(grossProfit: number): number {
  return Math.ceil(grossProfit * 0.05);
}

function clonePlayers(players: Record<string, PlayerState>) {
  return Object.fromEntries(
    Object.entries(players).map(([id, player]) => [id, { ...player }])
  );
}
