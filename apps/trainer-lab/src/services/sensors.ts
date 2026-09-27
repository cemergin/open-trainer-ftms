import {
  createMockSensor,
  createWebBluetoothSensor,
  type Sensor,
  type SensorKind,
  type SensorState,
  type SensorTelemetry,
} from "@open-trainer/ftms/sensors";
import type { TrainerTelemetry, Unsubscribe } from "@open-trainer/ftms";

export type { SensorKind, SensorState, SensorTelemetry } from "@open-trainer/ftms/sensors";
export type SensorMetric = "power" | "cadence" | "heartRate";
export type TelemetrySource = "trainer" | "external" | "none";
export interface SensorSources {
  readonly power: TelemetrySource;
  readonly cadence: TelemetrySource;
  readonly heartRate: TelemetrySource;
}
export interface SensorSlot {
  readonly state: SensorState;
  readonly telemetry: SensorTelemetry;
  readonly simulator: boolean;
}
export interface SensorManagerState {
  readonly sources: SensorSources;
  readonly sensors: Readonly<Record<SensorKind, SensorSlot | null>>;
}
export interface SensorMetricSource {
  readonly source: TelemetrySource;
  readonly sensorName: string | null;
  readonly simulator: boolean | null;
}
export interface SensorSourceSnapshot {
  readonly power: SensorMetricSource;
  readonly cadence: SensorMetricSource;
  readonly heartRate: SensorMetricSource;
}

const METRIC_FIELDS = [
  ["power", "power", "instantaneousPowerWatts"],
  ["cadence", "cadence", "instantaneousCadenceRpm"],
  ["heartRate", "heart-rate", "heartRateBpm"],
] as const;

export interface ResolvedTelemetry {
  powerW: number | null;
  cadenceRpm: number | null;
  heartRateBpm: number | null;
  sources: SensorSources;
}

type SensorFactory = (kind: SensorKind, simulator: boolean) => Sensor;
const EMPTY = (): SensorManagerState =>
  Object.freeze({
    sources: Object.freeze({ power: "trainer", cadence: "trainer", heartRate: "none" }),
    sensors: Object.freeze({ "heart-rate": null, cadence: null, power: null }),
  });

export class SensorManager {
  readonly #sensors = new Map<SensorKind, Sensor>();
  readonly #subscriptions = new Map<SensorKind, Unsubscribe[]>();
  readonly #listeners = new Set<(value: SensorManagerState) => void>();
  #current = EMPTY();
  readonly state: {
    readonly current: SensorManagerState;
    subscribe(listener: (value: SensorManagerState) => void): Unsubscribe;
  };

  constructor(
    private readonly factory: SensorFactory = (kind, simulator) =>
      simulator ? createMockSensor(kind) : createWebBluetoothSensor(kind),
  ) {
    const read = (): SensorManagerState => this.#current;
    this.state = Object.freeze({
      get current(): SensorManagerState {
        return read();
      },
      subscribe: (listener: (value: SensorManagerState) => void): Unsubscribe => {
        this.#listeners.add(listener);
        listener(this.#current);
        return () => this.#listeners.delete(listener);
      },
    });
  }

  /** Invoked by the pairing button; pairing itself does not change the selected data source. */
  connect(kind: SensorKind, simulator = false): Promise<void> {
    let sensor = this.#sensors.get(kind);
    if (sensor && this.#current.sensors[kind]?.simulator !== simulator) {
      throw new Error("Disconnect this sensor before changing between Bluetooth and demo.");
    }
    if (!sensor) {
      sensor = this.factory(kind, simulator);
      this.#sensors.set(kind, sensor);
      const currentSensor = sensor;
      const update = (): void => this.#updateSlot(kind, currentSensor, simulator);
      this.#subscriptions.set(kind, [
        sensor.state.subscribe(update),
        sensor.telemetry.subscribe(update),
      ]);
    }
    return sensor.connect();
  }

  async disconnect(kind: SensorKind): Promise<void> {
    const sensor = this.#sensors.get(kind);
    if (!sensor) return;
    this.#sensors.delete(kind);
    for (const unsubscribe of this.#subscriptions.get(kind) ?? []) unsubscribe();
    this.#subscriptions.delete(kind);
    this.#publish({
      ...this.#current,
      sensors: Object.freeze({ ...this.#current.sensors, [kind]: null }),
    });
    await sensor.disconnect();
  }

  selectSource(metric: SensorMetric, source: TelemetrySource): void {
    this.#publish({
      ...this.#current,
      sources: Object.freeze({ ...this.#current.sources, [metric]: source }),
    });
  }

  resolve(
    trainer: Pick<
      TrainerTelemetry,
      "instantaneousPowerWatts" | "instantaneousCadenceRpm" | "heartRateBpm"
    >,
  ): ResolvedTelemetry {
    const resolve = (
      metric: SensorMetric,
      kind: SensorKind,
      trainerValue: number | undefined,
    ): number | null => {
      const source = this.#current.sources[metric];
      if (source === "none") return null;
      if (source === "trainer")
        return trainerValue !== undefined && Number.isFinite(trainerValue) ? trainerValue : null;
      const slot = this.#current.sensors[kind];
      return slot?.state.status === "connected" && slot.telemetry.fresh
        ? slot.telemetry.value
        : null;
    };
    return {
      powerW: resolve("power", "power", trainer.instantaneousPowerWatts),
      cadenceRpm: resolve("cadence", "cadence", trainer.instantaneousCadenceRpm),
      heartRateBpm: resolve("heartRate", "heart-rate", trainer.heartRateBpm),
      sources: this.#current.sources,
    };
  }

  /** Copies the trainer packet and applies only the explicitly selected measurement sources. */
  applyToTelemetry(trainer: TrainerTelemetry, simulator: boolean): TrainerTelemetry {
    const packet = { ...trainer };
    delete packet.instantaneousPowerWatts;
    delete packet.instantaneousCadenceRpm;
    delete packet.heartRateBpm;
    const resolved = this.resolve(trainer);
    const values = {
      power: resolved.powerW,
      cadence: resolved.cadenceRpm,
      heartRate: resolved.heartRateBpm,
    };
    for (const [metric, kind, field] of METRIC_FIELDS) {
      const slot = this.#current.sensors[kind];
      const mixed =
        this.#current.sources[metric] === "external" && slot && slot.simulator !== simulator;
      const value = values[metric];
      if (value !== null && !mixed) packet[field] = value;
    }
    return packet;
  }

  hasMixedSources(simulator: boolean): boolean {
    return METRIC_FIELDS.some(([metric, kind]) => {
      const slot = this.#current.sensors[kind];
      return (
        this.#current.sources[metric] === "external" &&
        slot !== null &&
        slot.simulator !== simulator
      );
    });
  }

  sourceSnapshot(simulator: boolean): SensorSourceSnapshot {
    const snapshot = (metric: SensorMetric, kind: SensorKind): SensorMetricSource => {
      const source = this.#current.sources[metric];
      const slot = this.#current.sensors[kind];
      return Object.freeze({
        source,
        sensorName: source === "external" ? (slot?.state.name ?? null) : null,
        simulator:
          source === "trainer"
            ? simulator
            : source === "external"
              ? (slot?.simulator ?? null)
              : null,
      });
    };
    return Object.freeze({
      power: snapshot("power", "power"),
      cadence: snapshot("cadence", "cadence"),
      heartRate: snapshot("heartRate", "heart-rate"),
    });
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.#sensors.keys()].map((kind) => this.disconnect(kind)));
    this.#listeners.clear();
  }

  #updateSlot(kind: SensorKind, sensor: Sensor, simulator: boolean): void {
    if (this.#sensors.get(kind) !== sensor) return;
    this.#publish({
      ...this.#current,
      sensors: Object.freeze({
        ...this.#current.sensors,
        [kind]: Object.freeze({
          state: sensor.state.current,
          telemetry: sensor.telemetry.current,
          simulator,
        }),
      }),
    });
  }

  #publish(state: SensorManagerState): void {
    this.#current = Object.freeze(state);
    for (const listener of this.#listeners) listener(this.#current);
  }
}
