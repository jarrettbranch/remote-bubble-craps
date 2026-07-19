export interface DiceResult {
  rollId: string;
  die1: number;
  die2: number;
}

export interface DiceDeviceStatus {
  kind: "simulated" | "usb-serial";
  label: string;
  connected: boolean;
  rolling: boolean;
  lastError: string | null;
}

export interface DiceDevice {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): DiceDeviceStatus;
  requestRoll(rollId: string): Promise<void>;
  onResult(callback: (result: DiceResult) => void): () => void;
}
