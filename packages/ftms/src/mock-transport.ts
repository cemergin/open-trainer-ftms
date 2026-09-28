import { CONTROL_OPCODE } from "./commands.js";
import { FtmsError } from "./errors.js";
import { EventSource } from "./reactive.js";
import { CONTROL_RESULT, type FtmsTransport, type Unsubscribe } from "./types.js";
import { FTMS_UUIDS } from "./uuids.js";

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

export interface MockFtmsTransportOptions {
  controlResponseDelayMs?: number;
  resistanceControlFormat?: "sint16" | "uint8";
  supportsTargetCadence?: boolean;
  supportsSpindown?: boolean;
}

export class MockFtmsTransport implements FtmsTransport {
  readonly deviceName = "Simulated FTMS Trainer";
  readonly #disconnectSignal = new EventSource<void>();
  readonly #subscriptions = new Map<number, Set<(value: DataView) => void>>();
  readonly #commandHistory: number[] = [];

  #connected = false;
  #connectCount = 0;
  #controlled = false;
  #running = false;
  #targetPower = 140;
  #controlMode: "power" | "resistance" | "simulation" = "power";
  #grade = 0;
  #power = 0;
  #cadence = 0;
  #targetCadence = 86;
  #generation = 0;
  #speed = 0;
  #resistance = 0;
  #distance = 0;
  #elapsed = 0;
  #lastTick = 0;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: MockFtmsTransportOptions = {}) {}

  get commandHistory(): readonly number[] {
    return this.#commandHistory;
  }

  get connectCount(): number {
    return this.#connectCount;
  }

  subscriptionCount(characteristic: number): number {
    return this.#subscriptions.get(characteristic)?.size ?? 0;
  }

  get isConnected(): boolean {
    return this.#connected;
  }

  async connect(): Promise<void> {
    if (this.#connected) return;
    this.#connected = true;
    this.#connectCount += 1;
    this.#lastTick = performance.now();
    this.#timer = setInterval(() => this.#tick(), 250);
  }

  async disconnect(): Promise<void> {
    if (!this.#connected) return;
    this.#connected = false;
    this.#generation += 1;
    this.#controlled = false;
    this.#running = false;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#subscriptions.clear();
    this.#disconnectSignal.emit();
  }

  async read(characteristic: number): Promise<DataView> {
    this.#assertConnected();

    if (characteristic === FTMS_UUIDS.feature) {
      const bytes = new Uint8Array(8);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, (1 << 1) | (1 << 7) | (1 << 14), true);
      view.setUint32(
        4,
        (1 << 2) |
          (1 << 3) |
          (1 << 13) |
          (this.options.supportsTargetCadence ? 1 << 16 : 0) |
          (this.options.supportsSpindown ? 1 << 15 : 0),
        true,
      );
      return view;
    }

    if (characteristic === FTMS_UUIDS.supportedPowerRange) {
      const bytes = new Uint8Array(6);
      const view = new DataView(bytes.buffer);
      view.setInt16(0, 0, true);
      view.setInt16(2, 1800, true);
      view.setUint16(4, 1, true);
      return view;
    }

    if (characteristic === FTMS_UUIDS.supportedResistanceRange) {
      if (this.options.resistanceControlFormat === "uint8") {
        return dataView(Uint8Array.of(0, 20, 1));
      }
      const bytes = new Uint8Array(6);
      const view = new DataView(bytes.buffer);
      view.setInt16(0, 0, true);
      view.setInt16(2, 200, true);
      view.setUint16(4, 1, true);
      return view;
    }

    throw new FtmsError(`Mock characteristic 0x${characteristic.toString(16)} is not readable.`);
  }

  async write(characteristic: number, value: Uint8Array): Promise<void> {
    this.#assertConnected();
    if (characteristic !== FTMS_UUIDS.controlPoint) {
      throw new FtmsError(`Mock characteristic 0x${characteristic.toString(16)} is not writable.`);
    }

    const opcode = value[0];
    if (opcode === undefined) throw new FtmsError("Mock received an empty command.");
    this.#commandHistory.push(opcode);
    let result: number = CONTROL_RESULT.success;
    let machineStatus: Uint8Array | undefined;
    let responseParameters: number[] = [];

    switch (opcode) {
      case CONTROL_OPCODE.requestControl:
        this.#controlled = true;
        break;
      case CONTROL_OPCODE.reset:
        this.#controlled = false;
        this.#running = false;
        machineStatus = Uint8Array.of(0x01);
        break;
      case CONTROL_OPCODE.startResume:
        if (!this.#controlled) result = CONTROL_RESULT.controlNotPermitted;
        else {
          this.#running = true;
          machineStatus = Uint8Array.of(0x04);
        }
        break;
      case CONTROL_OPCODE.stopPause:
        if (!this.#controlled) result = CONTROL_RESULT.controlNotPermitted;
        else {
          this.#running = false;
          machineStatus = Uint8Array.of(0x02, value[1] ?? 0x01);
        }
        break;
      case CONTROL_OPCODE.setTargetPower:
        if (!this.#controlled) result = CONTROL_RESULT.controlNotPermitted;
        else if (value.byteLength < 3) result = CONTROL_RESULT.invalidParameter;
        else {
          this.#controlMode = "power";
          this.#targetPower = new DataView(
            value.buffer,
            value.byteOffset,
            value.byteLength,
          ).getInt16(1, true);
        }
        break;
      case CONTROL_OPCODE.setTargetResistance:
        if (!this.#controlled) result = CONTROL_RESULT.controlNotPermitted;
        else if ((this.options.resistanceControlFormat ?? "sint16") === "uint8") {
          if (value.byteLength < 2) result = CONTROL_RESULT.invalidParameter;
          else {
            this.#controlMode = "resistance";
            this.#resistance = (value[1] ?? 0) / 10;
          }
        } else if (value.byteLength < 3) result = CONTROL_RESULT.invalidParameter;
        else {
          this.#controlMode = "resistance";
          this.#resistance =
            new DataView(value.buffer, value.byteOffset, value.byteLength).getInt16(1, true) / 10;
        }
        break;
      case CONTROL_OPCODE.setSimulation:
        if (!this.#controlled) result = CONTROL_RESULT.controlNotPermitted;
        else if (value.byteLength < 7) result = CONTROL_RESULT.invalidParameter;
        else {
          const grade =
            new DataView(value.buffer, value.byteOffset, value.byteLength).getInt16(3, true) / 100;
          this.#controlMode = "simulation";
          this.#grade = grade;
        }
        break;
      case CONTROL_OPCODE.setTargetCadence:
        if (!this.options.supportsTargetCadence) result = CONTROL_RESULT.notSupported;
        else if (!this.#controlled) result = CONTROL_RESULT.controlNotPermitted;
        else if (value.byteLength !== 3) result = CONTROL_RESULT.invalidParameter;
        else {
          this.#targetCadence =
            new DataView(value.buffer, value.byteOffset, value.byteLength).getUint16(1, true) / 2;
          machineStatus = Uint8Array.of(0x15, value[1] ?? 0, value[2] ?? 0);
        }
        break;
      case CONTROL_OPCODE.spinDown:
        if (!this.options.supportsSpindown) result = CONTROL_RESULT.notSupported;
        else if (!this.#controlled) result = CONTROL_RESULT.controlNotPermitted;
        else if (value.byteLength !== 2 || (value[1] !== 1 && value[1] !== 2))
          result = CONTROL_RESULT.invalidParameter;
        else {
          responseParameters = [0xd0, 0x07, 0xb8, 0x0b];
          if (value[1] === 1) machineStatus = Uint8Array.of(0x14, 0x01);
        }
        break;
      default:
        result = CONTROL_RESULT.notSupported;
    }

    const generation = this.#generation;
    const respond = (): void => {
      if (!this.#connected || generation !== this.#generation) return;
      this.#emit(
        FTMS_UUIDS.controlPoint,
        Uint8Array.of(0x80, opcode, result, ...responseParameters),
      );
      if (result === CONTROL_RESULT.success && machineStatus) {
        this.#emit(FTMS_UUIDS.machineStatus, machineStatus);
      }
    };
    const delay = this.options.controlResponseDelayMs ?? 0;
    if (delay > 0) setTimeout(respond, delay);
    else queueMicrotask(respond);
  }

  async subscribe(
    characteristic: number,
    listener: (value: DataView) => void,
  ): Promise<Unsubscribe> {
    this.#assertConnected();
    const listeners = this.#subscriptions.get(characteristic) ?? new Set();
    listeners.add(listener);
    this.#subscriptions.set(characteristic, listeners);
    return () => listeners.delete(listener);
  }

  onDisconnect(listener: () => void): Unsubscribe {
    return this.#disconnectSignal.subscribe(listener);
  }

  /** Testing hook for protocol notifications not driven by normal mock commands. */
  emitNotification(characteristic: number, bytes: Uint8Array): void {
    this.#assertConnected();
    this.#emit(characteristic, bytes);
  }

  /** Simulates another application taking FTMS control. */
  loseControl(): void {
    this.#assertConnected();
    this.#controlled = false;
    this.#running = false;
    this.#emit(FTMS_UUIDS.machineStatus, Uint8Array.of(0xff));
  }

  #assertConnected(): void {
    if (!this.#connected) throw new FtmsError("The simulated trainer is disconnected.");
  }

  #emit(characteristic: number, bytes: Uint8Array): void {
    const listeners = this.#subscriptions.get(characteristic);
    if (!listeners) return;
    for (const listener of listeners) listener(dataView(bytes));
  }

  #tick(): void {
    const now = performance.now();
    const deltaSeconds = Math.min((now - this.#lastTick) / 1000, 1);
    this.#lastTick = now;

    // Deterministic demonstration values, not a model of rider or trainer physics.
    const modePower =
      this.#controlMode === "power"
        ? this.#targetPower
        : this.#controlMode === "resistance"
          ? 60 + this.#resistance * 12
          : 130 + this.#grade * 18;
    const desiredPower = this.#running ? Math.max(0, Math.min(modePower, 1800)) : 0;
    this.#power += (desiredPower - this.#power) * Math.min(deltaSeconds * 2.2, 1);
    this.#cadence +=
      ((this.#running ? this.#targetCadence : 0) - this.#cadence) * Math.min(deltaSeconds * 2, 1);
    this.#speed +=
      ((this.#running ? 12 + this.#power * 0.085 : 0) - this.#speed) *
      Math.min(deltaSeconds * 1.5, 1);
    this.#distance += (this.#speed / 3.6) * deltaSeconds;
    if (this.#running) this.#elapsed += deltaSeconds;

    const flags = (1 << 2) | (1 << 4) | (1 << 5) | (1 << 6) | (1 << 11);
    const bytes = new Uint8Array(15);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, flags, true);
    view.setUint16(2, Math.max(0, Math.round(this.#speed * 100)), true);
    view.setUint16(4, Math.max(0, Math.round(this.#cadence * 2)), true);
    const distance = Math.max(0, Math.round(this.#distance));
    view.setUint8(6, distance & 0xff);
    view.setUint8(7, (distance >> 8) & 0xff);
    view.setUint8(8, (distance >> 16) & 0xff);
    view.setInt16(9, Math.round(this.#resistance * 10), true);
    view.setInt16(11, Math.round(this.#power), true);
    view.setUint16(13, Math.round(this.#elapsed), true);
    this.#emit(FTMS_UUIDS.indoorBikeData, bytes);
  }
}
