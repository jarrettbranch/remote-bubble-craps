import {
  DiceDevice,
  DiceDeviceStatus,
  DiceResult
} from "./DiceDevice.js";

export interface SimulatedDiceDeviceOptions {
  rollDelayMs?: number;
  rng?: () => number;
}

export class SimulatedDiceDevice implements DiceDevice {
  private connected = false;
  private rolling = false;
  private lastError: string | null = null;
  private callback: ((result: DiceResult) => void) | null = null;
  private readonly rollDelayMs: number;
  private readonly rng: () => number;

  constructor(options: SimulatedDiceDeviceOptions = {}) {
    this.rollDelayMs = options.rollDelayMs ?? 900;
    this.rng = options.rng ?? Math.random;
  }

  async connect(): Promise<void> {
    this.connected = true;
    this.lastError = null;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.rolling = false;
  }

  getStatus(): DiceDeviceStatus {
    return {
      kind: "simulated",
      label: "Simulated",
      connected: this.connected,
      rolling: this.rolling,
      lastError: this.lastError
    };
  }

  async requestRoll(rollId: string): Promise<void> {
    if (!this.connected) {
      this.lastError = "Simulated dice device is not connected.";
      throw new Error(this.lastError);
    }

    if (this.rolling) {
      this.lastError = "A roll is already in progress.";
      throw new Error(this.lastError);
    }

    this.rolling = true;
    this.lastError = null;

    setTimeout(() => {
      const die1 = this.fairDie();
      const die2 = this.fairDie();
      this.rolling = false;
      this.callback?.({ rollId, die1, die2 });
    }, this.rollDelayMs);
  }

  onResult(callback: (result: DiceResult) => void): () => void {
    this.callback = callback;
    return () => {
      if (this.callback === callback) {
        this.callback = null;
      }
    };
  }

  private fairDie(): number {
    return Math.floor(this.rng() * 6) + 1;
  }
}
