import type { StateValue, Stream } from "./reactive.js";

export type Unsubscribe = () => void;

export interface FtmsTransport {
  readonly isConnected: boolean;
  readonly deviceName: string | undefined;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  read(characteristic: number): Promise<DataView>;
  write(characteristic: number, value: Uint8Array): Promise<void>;
  subscribe(
    characteristic: number,
    listener: (value: DataView) => void,
  ): Promise<Unsubscribe>;
  onDisconnect(listener: () => void): Unsubscribe;
}

export interface ValueRange {
  minimum: number;
  maximum: number;
  increment: number;
}

export interface TrainerCapabilities {
  machineFeatures: number;
  targetSettingFeatures: number;
  supportsCadence: boolean;
  supportsResistanceMeasurement: boolean;
  supportsPowerMeasurement: boolean;
  supportsResistanceTarget: boolean;
  supportsPowerTarget: boolean;
  supportsSimulation: boolean;
  supportsSpindown: boolean;
  supportsTargetCadence: boolean;
  resistanceRange?: ValueRange;
  powerRange?: ValueRange;
}

export interface TrainerTelemetry {
  timestamp: number;
  instantaneousSpeedKph?: number;
  averageSpeedKph?: number;
  instantaneousCadenceRpm?: number;
  averageCadenceRpm?: number;
  totalDistanceMeters?: number;
  resistanceLevel?: number;
  instantaneousPowerWatts?: number;
  averagePowerWatts?: number;
  totalEnergyKcal?: number;
  energyPerHourKcal?: number;
  energyPerMinuteKcal?: number;
  heartRateBpm?: number;
  metabolicEquivalent?: number;
  elapsedTimeSeconds?: number;
  remainingTimeSeconds?: number;
}

export type TrainerConnectionState =
  | "disconnected"
  | "connecting"
  | "ready"
  | "error";

export type TrainerControlState =
  | "unavailable"
  | "requesting"
  | "owned"
  | "revoked";

export type TrainerActivityState =
  | "idle"
  | "running"
  | "paused"
  | "stopping";

export const CONTROL_RESULT = {
  success: 0x01,
  notSupported: 0x02,
  invalidParameter: 0x03,
  operationFailed: 0x04,
  controlNotPermitted: 0x05,
} as const;

export interface ControlPointResponse {
  responseOpcode: 0x80;
  requestOpcode: number;
  resultCode: number;
  responseParameters: Uint8Array;
}

export interface SimulationParameters {
  /** Metres per second. Negative values are a tailwind. */
  windSpeedMps?: number;
  /** Road grade in percent. */
  gradePercent: number;
  /** Unitless coefficient, commonly around 0.004. */
  rollingResistance?: number;
  /** Kilograms per metre, commonly around 0.51. */
  windResistanceKgPerM?: number;
}

export interface TrainerOptions {
  commandTimeoutMs?: number;
  autoStartTelemetry?: boolean;
}

export interface Trainer {
  readonly deviceName: string | undefined;
  readonly connection: StateValue<TrainerConnectionState>;
  readonly control: StateValue<TrainerControlState>;
  readonly activity: StateValue<TrainerActivityState>;
  readonly capabilities: StateValue<TrainerCapabilities | null>;
  readonly telemetry: StateValue<TrainerTelemetry | null>;
  readonly controlResponses: Stream<ControlPointResponse>;
  readonly machineStatus: Stream<Uint8Array>;
  readonly errors: Stream<Error>;

  connect(): Promise<TrainerCapabilities>;
  disconnect(): Promise<void>;
  acquireControl(): Promise<ControlPointResponse>;
  start(): Promise<ControlPointResponse>;
  pause(): Promise<ControlPointResponse>;
  stop(): Promise<ControlPointResponse>;
  reset(): Promise<ControlPointResponse>;
  setTargetPower(watts: number): Promise<ControlPointResponse>;
  setResistanceLevel(level: number): Promise<ControlPointResponse>;
  setSimulation(parameters: SimulationParameters): Promise<ControlPointResponse>;
}
