import { BetKind, GameState } from "@bubble-craps/shared";

export type ClientMessage =
  | {
      type: "authenticate";
      accessToken: string;
    }
  | {
      type: "join";
      displayName: string;
    }
  | {
      type: "placeBet";
      kind: BetKind;
      amount: number;
    }
  | {
      type: "removeBet";
      betId: string;
    }
  | {
      type: "requestRoll";
    }
  | {
      type: "rebuyChips";
    }
  | {
      type: "chat";
      message: string;
    };

export type ServerMessage =
  | {
      type: "state";
      state: GameState & { countdownRemainingMs: number };
    }
  | {
      type: "joined";
      playerId: string;
    }
  | {
      type: "authenticated";
      playerId: string;
    }
  | {
      type: "error";
      message: string;
    };
