import type { StateValue } from "./reactive.js";

export type SensorKind = "heart-rate" | "cadence" | "power";
export type SensorStatus = "disconnected" | "connecting" | "connected" | "error";

export interface SensorState {
  readonly status: SensorStatus;
  readonly name: string | null;
  readonly error: string | null;
}

/** value is bpm, crank rpm, or watts according to kind. Stale values are null. */
export interface SensorTelemetry {
  readonly value: number | null;
  readonly updatedAt: number | null;
  readonly fresh: boolean;
  readonly batteryPercent: number | null;
}

export interface Sensor {
  readonly kind: SensorKind;
  readonly state: StateValue<SensorState>;
  readonly telemetry: StateValue<SensorTelemetry>;
  /** Call directly from a user gesture to open the Bluetooth chooser. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface SensorTransport {
  connect(
    kind: SensorKind,
    onMeasurement: (value: DataView) => void,
    onDisconnect: () => void,
  ): Promise<{ name: string | null; batteryPercent: number | null }>;
  disconnect(): Promise<void>;
}

export interface SensorOptions {
  staleAfterMs?: number;
  now?: () => number;
}

export const SENSOR_UUIDS = Object.freeze({
  "heart-rate": { service: 0x180d, measurement: 0x2a37 },
  cadence: { service: 0x1816, measurement: 0x2a5b },
  power: { service: 0x1818, measurement: 0x2a63 },
  battery: { service: 0x180f, level: 0x2a19 },
});
