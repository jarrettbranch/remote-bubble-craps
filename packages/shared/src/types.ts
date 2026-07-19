export const POINT_NUMBERS = [4, 5, 6, 8, 9, 10] as const;

export type PointNumber = (typeof POINT_NUMBERS)[number];

export type TablePhase = "comeOut" | "point";

export type BettingStatus = "open" | "locked";

export type BetKind =
  | "passLine"
  | "dontPass"
  | "passOdds"
  | "dontPassOdds"
  | "come"
  | "dontCome"
  | "field"
  | "place4"
  | "place5"
  | "place6"
  | "place8"
  | "place9"
  | "place10"
  | "lay4"
  | "lay5"
  | "lay6"
  | "lay8"
  | "lay9"
  | "lay10"
  | "anySeven"
  | "anyCraps"
  | "aces"
  | "aceDeuce"
  | "yo"
  | "boxcars"
  | "hard4"
  | "hard6"
  | "hard8"
  | "hard10";

export type SettlementOutcome =
  | "win"
  | "lose"
  | "push"
  | "moveToPoint"
  | "collect";

export interface PlayerState {
  id: string;
  displayName: string;
  balance: number;
  totalBuyIns: number;
  connected: boolean;
  joinedAt: number;
}

export interface Bet {
  id: string;
  playerId: string;
  kind: BetKind;
  amount: number;
  point: PointNumber | null;
  createdAt: number;
}

export interface BettingWindow {
  status: BettingStatus;
  durationMs: number;
  closesAt: number | null;
}

export interface DiceRoll {
  rollId: string;
  die1: number;
  die2: number;
  total: number;
  rolledAt: number;
}

export interface RollRecord extends DiceRoll {
  shooterId: string | null;
  phaseBefore: TablePhase;
  pointBefore: PointNumber | null;
  phaseAfter: TablePhase;
  pointAfter: PointNumber | null;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  displayName: string;
  message: string;
  createdAt: number;
}

export interface TableNotice {
  id: string;
  type: "roll_timeout";
  message: string;
  playerId: string | null;
  createdAt: number;
}

export interface DeviceSnapshot {
  kind: "simulated" | "usb-serial";
  label: string;
  connected: boolean;
  rolling: boolean;
  lastError: string | null;
}

export interface GameState {
  players: Record<string, PlayerState>;
  shooterId: string | null;
  phase: TablePhase;
  point: PointNumber | null;
  bets: Bet[];
  betting: BettingWindow;
  rollNumber: number;
  lastRoll: RollRecord | null;
  history: RollRecord[];
  settlementFeed: SettlementRecord[];
  notices: TableNotice[];
  chat: ChatMessage[];
  device: DeviceSnapshot;
}

export interface Settlement {
  betId: string;
  playerId: string;
  kind: BetKind;
  outcome: SettlementOutcome;
  credit: number;
  profit: number;
  description: string;
}

export interface SettlementRecord extends Settlement {
  id: string;
  rollId: string;
  displayName: string;
  createdAt: number;
}

export interface RollResolution {
  state: GameState;
  settlements: Settlement[];
  sevenOut: boolean;
}

export interface BetDefinition {
  kind: BetKind;
  label: string;
  allowedPhases: TablePhase[];
  point: PointNumber | null;
}
