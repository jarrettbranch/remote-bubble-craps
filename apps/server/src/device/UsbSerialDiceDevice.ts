import {
  DiceDevice,
  DiceDeviceStatus,
  DiceResult
} from "./DiceDevice.js";

/**
 * Future adapter for an ESP32-C3 dice machine connected over USB serial.
 *
 * Intended line-oriented protocol:
 *
 * PC -> ESP32:
 *   ROLL <rollId>
 *
 * ESP32 -> PC:
 *   ACK <rollId>
 *   ROLLING <rollId>
 *   RESULT <rollId> <die1> <die2>
 *   ERROR <rollId> <message>
 *
 * The browser must never talk to this device directly. Only the backend,
 * or a trusted local gateway controlled by the backend, may send ROLL.
 */
export class UsbSerialDiceDevice implements DiceDevice {
  private callback: ((result: DiceResult) => void) | null = null;
  private status: DiceDeviceStatus = {
    kind: "usb-serial",
    label: "USB Serial ESP32-C3",
    connected: false,
    rolling: false,
    lastError: "USB serial device support is not implemented yet."
  };

  async connect(): Promise<void> {
    const message = "USB serial device support is not implemented yet.";
    this.status = {
      ...this.status,
      connected: false,
      lastError: message
    };
    throw new Error(message);
  }

  async disconnect(): Promise<void> {
    this.status = {
      ...this.status,
      connected: false,
      rolling: false
    };
  }

  getStatus(): DiceDeviceStatus {
    return this.status;
  }

  async requestRoll(_rollId: string): Promise<void> {
    throw new Error("USB serial device support is not implemented yet.");
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
