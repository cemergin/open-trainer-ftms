import type { Trainer } from "./services";

/** Serializes manual actions while letting Stop cancel later simulator steps. */
export class LabControls {
  pending = false;
  stopping = false;
  #generation = 0;

  constructor(readonly trainer: Trainer, readonly simulator: boolean) {}

  get busy(): boolean { return this.pending || this.stopping; }

  async run(operation: () => Promise<unknown>): Promise<boolean> {
    if (this.busy) throw new Error("Wait for the pending command, or press Stop.");
    if (this.trainer.connection.current !== "ready") throw new Error("Connect a trainer first.");
    const generation = this.#generation;
    this.pending = true;
    try {
      await operation();
      return generation === this.#generation;
    } finally {
      this.pending = false;
    }
  }

  async simulatorSequence(): Promise<boolean> {
    if (!this.simulator) throw new Error("The test sequence is available only for the simulator.");
    if (!this.trainer.capabilities.current?.supportsPowerTarget) throw new Error("ERG power control is unavailable.");
    const generation = this.#generation;
    const current = () => generation === this.#generation && this.trainer.connection.current === "ready";
    return this.run(async () => {
      if (this.trainer.control.current !== "owned") await this.trainer.acquireControl();
      if (!current()) return;
      await this.trainer.setTargetPower(80);
      if (!current()) return;
      await this.trainer.start();
    });
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    if (this.trainer.connection.current !== "ready") throw new Error("Stop was not confirmed: the trainer is disconnected.");
    this.#generation += 1;
    this.stopping = true;
    try {
      await this.trainer.stop();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Stop was not confirmed. Resistance release is unknown. ${reason}`);
    } finally {
      this.stopping = false;
    }
  }
}

export function packetHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(" ").toUpperCase();
}
