import { StateSource } from "./reactive.js";
import {
  CrankCadence,
  parseCadence,
  parseCyclingPower,
  parseHeartRate,
} from "./sensors-parsers.js";
import {
  WebBluetoothSensorTransport,
  type WebBluetoothSensorOptions,
} from "./sensors-bluetooth.js";
import type {
  Sensor,
  SensorKind,
  SensorOptions,
  SensorState,
  SensorTelemetry,
  SensorTransport,
} from "./sensors-types.js";

export type {
  Sensor,
  SensorKind,
  SensorOptions,
  SensorState,
  SensorStatus,
  SensorTelemetry,
  SensorTransport,
} from "./sensors-types.js";
export { SENSOR_UUIDS } from "./sensors-types.js";
export {
  WebBluetoothSensorTransport,
  type WebBluetoothSensorOptions,
} from "./sensors-bluetooth.js";
export {
  CrankCadence,
  parseCadence,
  parseCyclingPower,
  parseHeartRate,
} from "./sensors-parsers.js";
export type { CrankMeasurement } from "./sensors-parsers.js";

const EMPTY_TELEMETRY: SensorTelemetry = Object.freeze({
  value: null,
  updatedAt: null,
  fresh: false,
  batteryPercent: null,
});

export class FitnessSensor implements Sensor {
  readonly #state = new StateSource<SensorState>(
    Object.freeze({ status: "disconnected", name: null, error: null }),
  );
  readonly #telemetry = new StateSource<SensorTelemetry>(EMPTY_TELEMETRY);
  readonly state = this.#state.asReadonly();
  readonly telemetry = this.#telemetry.asReadonly();
  readonly #cadence = new CrankCadence();
  readonly #now: () => number;
  readonly #staleAfterMs: number;
  #expiry: ReturnType<typeof setTimeout> | undefined;
  #generation = 0;
  #pending: Promise<void> | undefined;

  constructor(
    readonly kind: SensorKind,
    private readonly transport: SensorTransport,
    options: SensorOptions = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.#staleAfterMs = options.staleAfterMs ?? 5000;
    if (!Number.isFinite(this.#staleAfterMs) || this.#staleAfterMs < 1)
      throw new Error("Sensor staleAfterMs must be positive and finite.");
  }

  connect(): Promise<void> {
    if (this.#pending) return this.#pending;
    if (this.state.current.status === "connected") return Promise.resolve();
    const generation = ++this.#generation;
    this.#state.set(Object.freeze({ status: "connecting", name: null, error: null }));
    const operation = this.#connect(generation);
    this.#pending = operation;
    void operation
      .finally(() => {
        if (this.#pending === operation) this.#pending = undefined;
      })
      .catch(() => undefined);
    return operation;
  }

  async #connect(generation: number): Promise<void> {
    try {
      const details = await this.transport.connect(
        this.kind,
        (packet) => {
          if (generation === this.#generation) this.#receive(packet);
        },
        () => {
          if (generation === this.#generation) this.#disconnected();
        },
      );
      if (generation !== this.#generation) return;
      this.#state.set(Object.freeze({ status: "connected", name: details.name, error: null }));
      this.#telemetry.set(
        Object.freeze({ ...this.telemetry.current, batteryPercent: details.batteryPercent }),
      );
    } catch (error) {
      if (generation === this.#generation) {
        this.#generation += 1;
        this.#clear();
        this.#state.set(
          Object.freeze({
            status: "error",
            name: null,
            error: error instanceof Error ? error.message : "Sensor connection failed.",
          }),
        );
        await this.transport.disconnect().catch(() => undefined);
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.#disconnected();
    await this.transport.disconnect();
  }

  #disconnected(): void {
    this.#generation += 1;
    this.#clear();
    this.#state.set(
      Object.freeze({ status: "disconnected", name: this.state.current.name, error: null }),
    );
  }

  #clear(): void {
    clearTimeout(this.#expiry);
    this.#cadence.reset();
    this.#telemetry.set(EMPTY_TELEMETRY);
  }

  #receive(packet: DataView): void {
    let value: number | null;
    const now = this.#now();
    try {
      switch (this.kind) {
        case "heart-rate":
          value = parseHeartRate(packet);
          break;
        case "power":
          value = parseCyclingPower(packet);
          break;
        case "cadence": {
          const measurement = parseCadence(packet);
          if (!measurement) return;
          value = this.#cadence.update(measurement, now);
          break;
        }
      }
    } catch {
      return;
    }
    clearTimeout(this.#expiry);
    this.#telemetry.set(
      Object.freeze({
        value,
        updatedAt: now,
        fresh: value !== null,
        batteryPercent: this.telemetry.current.batteryPercent,
      }),
    );
    this.#expiry = setTimeout(() => {
      this.#cadence.reset();
      this.#telemetry.set(Object.freeze({ ...this.telemetry.current, value: null, fresh: false }));
    }, this.#staleAfterMs);
  }
}

export function createWebBluetoothSensor(
  kind: SensorKind,
  options: WebBluetoothSensorOptions = {},
  sensorOptions: SensorOptions = {},
): Sensor {
  return new FitnessSensor(kind, new WebBluetoothSensorTransport(options), sensorOptions);
}

/** Deterministic notifications exercise the same decoders and freshness as Bluetooth. */
export function createMockSensor(kind: SensorKind, options: SensorOptions = {}): Sensor {
  let timer: ReturnType<typeof setInterval> | undefined;
  let revolutions = 0;
  let eventTime = 0;
  const transport: SensorTransport = {
    connect(_kind, receive) {
      const tick = (): void => {
        const packet = new DataView(
          new ArrayBuffer(kind === "heart-rate" ? 2 : kind === "power" ? 4 : 5),
        );
        if (kind === "heart-rate") packet.setUint8(1, 142);
        else if (kind === "power") packet.setInt16(2, 185, true);
        else {
          revolutions = (revolutions + 1) % 0x10000;
          eventTime = (eventTime + 683) % 0x10000;
          packet.setUint8(0, 2);
          packet.setUint16(1, revolutions, true);
          packet.setUint16(3, eventTime, true);
        }
        receive(packet);
      };
      tick();
      timer = setInterval(tick, kind === "cadence" ? 667 : 1000);
      return Promise.resolve({ name: `Demo ${kind} sensor`, batteryPercent: 92 });
    },
    disconnect() {
      clearInterval(timer);
      return Promise.resolve();
    },
  };
  return new FitnessSensor(kind, transport, options);
}
