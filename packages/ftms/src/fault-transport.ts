import { FtmsRangeError, FtmsStateError } from "./errors.js";
import { EventSource } from "./reactive.js";
import type { FtmsTransport, Unsubscribe } from "./types.js";

export type TransportFault = {
  readonly operation: "read" | "write" | "notification";
  readonly characteristic?: number;
  /** Match the first byte (for example, a control opcode). */
  readonly opcode?: number;
  /** One-based matching occurrence; each rule fires once. Defaults to 1. */
  readonly occurrence?: number;
} & (
  | { readonly action: "delay"; readonly delayMs: number }
  | { readonly action: "replace"; readonly bytes: readonly number[] }
  | { readonly action: "reject" | "disconnect" }
  | { readonly action: "drop"; readonly operation: "notification" }
);

/** Explicit, one-shot faults for development. Never wraps hardware implicitly. */
export class FaultInjectionFtmsTransport implements FtmsTransport {
  readonly #rules: readonly TransportFault[];
  readonly #counts: number[];
  readonly #disconnects = new EventSource<void>();
  readonly #timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  #unsubscribe: Unsubscribe | undefined;
  #generation = 0;

  constructor(
    private readonly transport: FtmsTransport,
    faults: readonly TransportFault[],
  ) {
    this.#rules = faults.map((fault) => {
      if (!Number.isSafeInteger(fault.occurrence ?? 1) || (fault.occurrence ?? 1) < 1)
        throw new FtmsRangeError("Fault occurrence must be a positive integer.");
      if (
        fault.action === "delay" &&
        (!Number.isFinite(fault.delayMs) || fault.delayMs < 0 || fault.delayMs > 60_000)
      )
        throw new FtmsRangeError("Fault delay must be from 0 to 60000 milliseconds.");
      if (fault.action === "replace") {
        if (
          fault.bytes.length > 65535 ||
          fault.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
        )
          throw new FtmsRangeError("Fault replacement must contain bytes.");
        return { ...fault, bytes: [...fault.bytes] };
      }
      return { ...fault };
    });
    this.#counts = this.#rules.map(() => 0);
  }

  get isConnected(): boolean {
    return this.transport.isConnected;
  }
  get deviceName(): string | undefined {
    return this.transport.deviceName;
  }

  async connect(): Promise<void> {
    if (this.#unsubscribe) return;
    await this.transport.connect();
    this.#unsubscribe = this.transport.onDisconnect(() => {
      this.#generation += 1;
      for (const [timer, cancel] of this.#timers) {
        clearTimeout(timer);
        cancel();
      }
      this.#timers.clear();
      this.#unsubscribe?.();
      this.#unsubscribe = undefined;
      this.#disconnects.emit();
    });
  }

  async disconnect(): Promise<void> {
    await this.transport.disconnect();
  }
  onDisconnect(listener: () => void): Unsubscribe {
    return this.#disconnects.subscribe(listener);
  }

  async read(characteristic: number): Promise<DataView> {
    const value = await this.transport.read(characteristic);
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const fault = this.#match("read", characteristic, bytes);
    const replacement = await this.#apply(fault, bytes);
    return new DataView(
      replacement.buffer.slice(
        replacement.byteOffset,
        replacement.byteOffset + replacement.byteLength,
      ),
    );
  }

  async write(characteristic: number, value: Uint8Array): Promise<void> {
    const fault = this.#match("write", characteristic, value);
    const bytes = await this.#apply(fault, value.slice());
    await this.transport.write(characteristic, bytes);
  }

  async subscribe(
    characteristic: number,
    listener: (value: DataView) => void,
  ): Promise<Unsubscribe> {
    const generation = this.#generation;
    let active = true;
    const unsubscribe = await this.transport.subscribe(characteristic, (value) => {
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
      const fault = this.#match("notification", characteristic, bytes);
      if (fault?.action === "drop" || fault?.action === "reject") return;
      const deliver = (payload: Uint8Array): void => {
        if (active && generation === this.#generation)
          listener(
            new DataView(
              payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
            ),
          );
      };
      if (!fault) deliver(bytes);
      else void this.#apply(fault, bytes).then(deliver, () => undefined);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }

  #match(
    operation: TransportFault["operation"],
    characteristic: number,
    bytes: Uint8Array,
  ): TransportFault | undefined {
    let selected: TransportFault | undefined;
    this.#rules.forEach((rule, index) => {
      if (
        rule.operation !== operation ||
        (rule.characteristic !== undefined && rule.characteristic !== characteristic) ||
        (rule.opcode !== undefined && rule.opcode !== bytes[0])
      )
        return;
      this.#counts[index] = (this.#counts[index] ?? 0) + 1;
      if (this.#counts[index] === (rule.occurrence ?? 1) && !selected) selected = rule;
    });
    return selected;
  }

  async #apply(fault: TransportFault | undefined, bytes: Uint8Array): Promise<Uint8Array> {
    if (!fault) return bytes;
    switch (fault.action) {
      case "replace":
        return Uint8Array.from(fault.bytes);
      case "reject":
        throw new FtmsStateError("Injected transport failure.");
      case "disconnect":
        await this.transport.disconnect();
        throw new FtmsStateError("Injected disconnect.");
      case "drop":
        return bytes;
      case "delay":
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.#timers.delete(timer);
            resolve();
          }, fault.delayMs);
          this.#timers.set(timer, () =>
            reject(new FtmsStateError("Delayed fault cancelled by disconnect.")),
          );
        });
        return bytes;
    }
  }
}
