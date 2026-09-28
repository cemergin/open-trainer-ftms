import { FtmsProtocolError, FtmsRangeError, FtmsStateError } from "./errors.js";
import { EventSource } from "./reactive.js";
import type { FtmsTransport, Unsubscribe } from "./types.js";

export type TransportTraceEvent = {
  readonly atMs: number;
  readonly session: number;
} & (
  | { readonly kind: "connect" | "disconnect-request" | "disconnect" }
  | { readonly kind: "subscribe" | "unsubscribe"; readonly characteristic: number }
  | {
      readonly kind: "read" | "write" | "notification";
      readonly characteristic: number;
      readonly bytes: readonly number[];
    }
);

/** Portable protocol data only: no device names, addresses, or wall-clock timestamps. */
export interface TransportTrace {
  readonly version: 1;
  readonly truncated: boolean;
  readonly events: readonly TransportTraceEvent[];
}

export interface RecordingOptions {
  readonly maxEvents?: number;
  readonly maxBytes?: number;
}

function copyView(value: DataView): number[] {
  return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
}

function viewOf(bytes: readonly number[]): DataView {
  return new DataView(Uint8Array.from(bytes).buffer);
}

function positiveInteger(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new FtmsRangeError(`${label} must be an integer from 1 to ${maximum}.`);
  return value;
}

/** Validate untrusted JSON and discard properties outside the documented trace schema. */
export function parseTransportTrace(input: unknown): TransportTrace {
  if (typeof input !== "object" || input === null)
    throw new FtmsProtocolError("Invalid transport trace.");
  const trace = input as Record<string, unknown>;
  if (
    trace.version !== 1 ||
    typeof trace.truncated !== "boolean" ||
    !Array.isArray(trace.events) ||
    trace.events.length > 100_000
  ) {
    throw new FtmsProtocolError("Invalid transport trace header or event count.");
  }
  let previousTime = 0;
  let session = 0;
  let connected = false;
  let byteCount = 0;
  const events = (trace.events as unknown[]).map((input): TransportTraceEvent => {
    if (typeof input !== "object" || input === null)
      throw new FtmsProtocolError("Invalid trace event.");
    const event = input as Record<string, unknown>;
    const atMs = event.atMs;
    if (
      typeof atMs !== "number" ||
      !Number.isFinite(atMs) ||
      atMs < previousTime ||
      atMs > 86_400_000
    )
      throw new FtmsProtocolError("Trace times must increase and fit within 24 hours.");
    previousTime = atMs;
    if (event.kind === "connect") {
      if (connected) throw new FtmsProtocolError("Trace connects an already connected session.");
      session += 1;
      connected = true;
    } else if (!connected) throw new FtmsProtocolError("Trace operation has no connected session.");
    if (event.session !== session)
      throw new FtmsProtocolError("Trace session does not match the connection.");
    const base = { atMs, session };
    switch (event.kind) {
      case "connect":
      case "disconnect-request":
        return { ...base, kind: event.kind };
      case "disconnect":
        connected = false;
        return { ...base, kind: event.kind };
      case "subscribe":
      case "unsubscribe":
      case "read":
      case "write":
      case "notification": {
        const characteristic = event.characteristic;
        if (
          typeof characteristic !== "number" ||
          !Number.isInteger(characteristic) ||
          characteristic < 0 ||
          characteristic > 65535
        )
          throw new FtmsProtocolError("Invalid trace characteristic.");
        if (event.kind === "subscribe" || event.kind === "unsubscribe")
          return { ...base, kind: event.kind, characteristic };
        if (
          !Array.isArray(event.bytes) ||
          event.bytes.length > 65535 ||
          !(event.bytes as unknown[]).every(
            (byte) =>
              typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 255,
          )
        )
          throw new FtmsProtocolError("Invalid trace bytes.");
        byteCount += event.bytes.length;
        if (byteCount > 8_000_000) throw new FtmsProtocolError("Trace byte limit exceeded.");
        return { ...base, kind: event.kind, characteristic, bytes: [...(event.bytes as number[])] };
      }
      default:
        throw new FtmsProtocolError("Unknown trace event kind.");
    }
  });
  return { version: 1, truncated: trace.truncated, events };
}

interface RecordingSubscription {
  readonly listeners: Set<(value: DataView) => void>;
  readonly ready: Promise<Unsubscribe>;
}

export class RecordingFtmsTransport implements FtmsTransport {
  readonly #subscriptions = new Map<number, RecordingSubscription>();
  readonly #events: TransportTraceEvent[] = [];
  readonly #disconnects = new EventSource<void>();
  readonly #maxEvents: number;
  readonly #maxBytes: number;
  #bytes = 0;
  #truncated = false;
  #session = 0;
  readonly #origin = performance.now();
  #disconnectSubscription: Unsubscribe | undefined;

  constructor(
    private readonly transport: FtmsTransport,
    options: RecordingOptions = {},
  ) {
    this.#maxEvents = positiveInteger(options.maxEvents ?? 10_000, "maxEvents", 100_000);
    this.#maxBytes = positiveInteger(options.maxBytes ?? 1_000_000, "maxBytes", 8_000_000);
  }

  get isConnected(): boolean {
    return this.transport.isConnected;
  }
  get deviceName(): string | undefined {
    return this.transport.deviceName;
  }
  get capturedEventCount(): number {
    return this.#events.length;
  }
  get isTruncated(): boolean {
    return this.#truncated;
  }

  get trace(): TransportTrace {
    return {
      version: 1,
      truncated: this.#truncated,
      events: this.#events.map((event) =>
        "bytes" in event ? { ...event, bytes: [...event.bytes] } : { ...event },
      ),
    };
  }

  async connect(): Promise<void> {
    if (this.isConnected)
      throw new FtmsStateError("Recording must begin before connecting the transport.");
    await this.transport.connect();
    this.#session += 1;
    this.#record({ kind: "connect" });
    this.#disconnectSubscription = this.transport.onDisconnect(() => {
      this.#record({ kind: "disconnect" });
      this.#subscriptions.clear();
      this.#disconnectSubscription?.();
      this.#disconnectSubscription = undefined;
      this.#disconnects.emit();
    });
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) return;
    this.#record({ kind: "disconnect-request" });
    try {
      await this.transport.disconnect();
    } catch (error) {
      this.#truncated = true;
      throw error;
    }
  }

  async read(characteristic: number): Promise<DataView> {
    try {
      const value = await this.transport.read(characteristic);
      this.#record({ kind: "read", characteristic, bytes: copyView(value) });
      return value;
    } catch (error) {
      this.#truncated = true;
      throw error;
    }
  }

  async write(characteristic: number, value: Uint8Array): Promise<void> {
    this.#record({ kind: "write", characteristic, bytes: Array.from(value) });
    try {
      await this.transport.write(characteristic, value);
    } catch (error) {
      this.#truncated = true;
      throw error;
    }
  }

  async subscribe(
    characteristic: number,
    listener: (value: DataView) => void,
  ): Promise<Unsubscribe> {
    let subscription = this.#subscriptions.get(characteristic);
    if (!subscription) {
      const listeners = new Set<(value: DataView) => void>();
      this.#record({ kind: "subscribe", characteristic });
      const ready = this.transport.subscribe(characteristic, (value) => {
        this.#record({ kind: "notification", characteristic, bytes: copyView(value) });
        for (const receive of [...listeners]) receive(value);
      });
      subscription = { listeners, ready };
      this.#subscriptions.set(characteristic, subscription);
    }
    const current = subscription;
    current.listeners.add(listener);
    let unsubscribe: Unsubscribe;
    try {
      unsubscribe = await current.ready;
    } catch (error) {
      this.#subscriptions.delete(characteristic);
      this.#truncated = true;
      throw error;
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      current.listeners.delete(listener);
      if (current.listeners.size > 0) return;
      if (this.#subscriptions.get(characteristic) === current) {
        this.#subscriptions.delete(characteristic);
        if (this.isConnected) this.#record({ kind: "unsubscribe", characteristic });
      }
      unsubscribe();
    };
  }

  onDisconnect(listener: () => void): Unsubscribe {
    return this.#disconnects.subscribe(listener);
  }

  #record(
    event:
      | Omit<
          Extract<TransportTraceEvent, { kind: "connect" | "disconnect-request" | "disconnect" }>,
          "atMs" | "session"
        >
      | Omit<
          Extract<TransportTraceEvent, { kind: "subscribe" | "unsubscribe" }>,
          "atMs" | "session"
        >
      | Omit<
          Extract<TransportTraceEvent, { kind: "read" | "write" | "notification" }>,
          "atMs" | "session"
        >,
  ): void {
    if (this.#truncated) return;
    const size = "bytes" in event ? event.bytes.length : 0;
    const atMs = performance.now() - this.#origin;
    if (
      this.#events.length >= this.#maxEvents ||
      this.#bytes + size > this.#maxBytes ||
      size > 65535 ||
      atMs > 86_400_000
    ) {
      this.#truncated = true;
      return;
    }
    this.#bytes += size;
    this.#events.push({ ...event, atMs, session: this.#session });
  }
}

/** Offline only: no hardware transport is accepted or accessed. */
export class ReplayFtmsTransport implements FtmsTransport {
  readonly deviceName = "Recorded FTMS session";
  readonly #trace: TransportTrace;
  readonly #disconnects = new EventSource<void>();
  readonly #listeners = new Map<number, Set<(value: DataView) => void>>();
  #connected = false;
  #disposed = false;
  #cleanup: Promise<void> = Promise.resolve();
  #index = 0;
  #lastTime = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  readonly #idleWaiters = new Set<() => void>();

  constructor(trace: TransportTrace) {
    this.#trace = parseTransportTrace(trace);
    if (trace.truncated)
      throw new FtmsProtocolError("A truncated trace cannot be replayed reliably.");
  }

  get isConnected(): boolean {
    return this.#connected;
  }
  get remainingEvents(): number {
    return this.#trace.events.length - this.#index;
  }

  /** Snapshot of the next expected operation, for offline replay drivers. */
  get nextEvent(): TransportTraceEvent | undefined {
    const event = this.#trace.events[this.#index];
    return event && ("bytes" in event ? { ...event, bytes: [...event.bytes] } : { ...event });
  }

  /** Wait until all currently scheduled notifications/disconnects have been delivered. */
  drain(): Promise<void> {
    this.#schedule();
    if (this.#timer === undefined) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.add(resolve));
  }

  async connect(): Promise<void> {
    await this.#prepare();
    this.#take("connect");
    this.#connected = true;
    this.#schedule();
    return Promise.resolve();
  }

  async disconnect(): Promise<void> {
    await this.#prepare();
    if (!this.#connected) return;
    this.#take("disconnect-request");
    this.#take("disconnect");
    this.#disconnected();
    return Promise.resolve();
  }

  async read(characteristic: number): Promise<DataView> {
    await this.#prepare();
    const event = this.#take("read", characteristic);
    this.#schedule();
    return Promise.resolve(viewOf("bytes" in event ? event.bytes : []));
  }

  async write(characteristic: number, value: Uint8Array): Promise<void> {
    value = value.slice();
    await this.#prepare();
    const event = this.#peek("write", characteristic);
    if (
      !("bytes" in event) ||
      value.length !== event.bytes.length ||
      value.some((byte, index) => byte !== event.bytes[index])
    )
      throw new FtmsProtocolError("Replay write differs from the recorded command.");
    this.#take("write", characteristic);
    this.#schedule();
    return Promise.resolve();
  }

  async subscribe(
    characteristic: number,
    listener: (value: DataView) => void,
  ): Promise<Unsubscribe> {
    if (!this.#listeners.has(characteristic)) await this.#prepare();
    let listeners = this.#listeners.get(characteristic);
    if (!listeners) {
      this.#take("subscribe", characteristic);
      listeners = new Set();
      this.#listeners.set(characteristic, listeners);
    }
    const current = listeners;
    current.add(listener);
    this.#schedule();
    let active = true;
    return Promise.resolve(() => {
      if (!active) return;
      active = false;
      current.delete(listener);
      if (current.size > 0) return;
      if (this.#listeners.get(characteristic) === current) {
        this.#listeners.delete(characteristic);
        if (this.#connected) {
          this.#cleanup = this.#cleanup.then(async () => {
            await this.drain();
            if (this.#connected) this.#take("unsubscribe", characteristic);
            this.#schedule();
          });
          // Disconnect or the next operation observes and reports any mismatch.
          void this.#cleanup.catch(() => undefined);
        }
      }
      this.#schedule();
    });
  }

  onDisconnect(listener: () => void): Unsubscribe {
    return this.#disconnects.subscribe(listener);
  }

  assertComplete(): void {
    if (this.remainingEvents !== 0)
      throw new FtmsProtocolError(`Replay has ${this.remainingEvents} unconsumed events.`);
  }

  /** Abandon an incomplete replay and release its timers without touching hardware. */
  dispose(): void {
    this.#disposed = true;
    this.#releaseSession();
  }

  #releaseSession(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#listeners.clear();
    const connected = this.#connected;
    this.#connected = false;
    for (const resolve of this.#idleWaiters) resolve();
    this.#idleWaiters.clear();
    if (connected) this.#disconnects.emit();
  }

  async #prepare(): Promise<void> {
    await this.#cleanup;
    await this.drain();
    if (this.#disposed) throw new FtmsStateError("Replay has been disposed.");
  }

  #peek(kind: TransportTraceEvent["kind"], characteristic?: number): TransportTraceEvent {
    const event = this.#trace.events[this.#index];
    if (
      event?.kind !== kind ||
      (characteristic !== undefined &&
        (!("characteristic" in event) || event.characteristic !== characteristic))
    )
      throw new FtmsProtocolError(
        `Replay expected ${event?.kind ?? "end of trace"}, received ${kind}.`,
      );
    return event;
  }

  #take(kind: TransportTraceEvent["kind"], characteristic?: number): TransportTraceEvent {
    const event = this.#peek(kind, characteristic);
    this.#index += 1;
    this.#lastTime = event.atMs;
    return event;
  }

  #schedule(): void {
    if (this.#timer !== undefined) return;
    const event = this.#trace.events[this.#index];
    if (!event || (event.kind !== "notification" && event.kind !== "disconnect")) {
      for (const resolve of this.#idleWaiters) resolve();
      this.#idleWaiters.clear();
      return;
    }
    this.#timer = setTimeout(
      () => {
        this.#timer = undefined;
        this.#take(event.kind);
        if (event.kind === "disconnect") this.#disconnected();
        else if (event.kind === "notification") {
          for (const listener of this.#listeners.get(event.characteristic) ?? [])
            listener(viewOf(event.bytes));
        }
        this.#schedule();
      },
      Math.max(0, event.atMs - this.#lastTime),
    );
  }

  #disconnected(): void {
    this.#releaseSession();
  }
}
