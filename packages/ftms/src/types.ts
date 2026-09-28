import type { StateValue, Stream } from "./reactive.js";

export type Unsubscribe = () => void;

export interface FtmsTransport {
  readonly isConnected: boolean;
  readonly deviceName: string | undefined;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  read(characteristic: number): Promise<DataView>;
  write(characteristic: number, value: Uint8Array): Promise<void>;
  subscribe(characteristic: number, listener: (value: DataView) => void): Promise<Unsubscribe>;
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

export type TrainerConnectionState = "disconnected" | "connecting" | "ready" | "error";

export type TrainerControlState = "unavailable" | "requesting" | "owned" | "revoked";

export type TrainerActivityState = "idle" | "running" | "paused" | "stopping";

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

export type MachineStatusKind =
  | "reset"
  | "stopped-or-paused-by-user"
  | "stopped-by-safety-key"
  | "started-or-resumed-by-user"
  | "target-speed-changed"
  | "target-inclination-changed"
  | "target-resistance-changed"
  | "target-power-changed"
  | "target-heart-rate-changed"
  | "target-energy-changed"
  | "target-steps-changed"
  | "target-strides-changed"
  | "target-distance-changed"
  | "target-training-time-changed"
  | "target-time-two-heart-rate-zones-changed"
  | "target-time-three-heart-rate-zones-changed"
  | "target-time-five-heart-rate-zones-changed"
  | "simulation-parameters-changed"
  | "wheel-circumference-changed"
  | "spin-down-status"
  | "target-cadence-changed"
  | "control-permission-lost"
  | "unknown";

/** Decoded FTMS 1.0.1 values, in the units named by each field. */
export interface MachineStatusParameters {
  reset: undefined;
  "stopped-or-paused-by-user": { control: "stop" | "pause" | "unknown"; controlCode: number };
  "stopped-by-safety-key": undefined;
  "started-or-resumed-by-user": undefined;
  "target-speed-changed": { speedKph: number };
  "target-inclination-changed": { inclinationPercent: number };
  "target-resistance-changed": { resistanceLevel: number };
  "target-power-changed": { powerWatts: number };
  "target-heart-rate-changed": { heartRateBpm: number };
  "target-energy-changed": { energyKcal: number };
  "target-steps-changed": { steps: number };
  "target-strides-changed": { strides: number };
  "target-distance-changed": { distanceMeters: number };
  "target-training-time-changed": { timeSeconds: number };
  "target-time-two-heart-rate-zones-changed": { fatBurnSeconds: number; fitnessSeconds: number };
  "target-time-three-heart-rate-zones-changed": {
    lightSeconds: number;
    moderateSeconds: number;
    hardSeconds: number;
  };
  "target-time-five-heart-rate-zones-changed": {
    veryLightSeconds: number;
    lightSeconds: number;
    moderateSeconds: number;
    hardSeconds: number;
    maximumSeconds: number;
  };
  "simulation-parameters-changed": Required<SimulationParameters>;
  "wheel-circumference-changed": { circumferenceMm: number };
  "spin-down-status": {
    status: "requested" | "success" | "error" | "stop-pedaling" | "unknown";
    statusCode: number;
  };
  "target-cadence-changed": { cadenceRpm: number };
  "control-permission-lost": undefined;
  unknown: undefined;
}

export type MachineStatus = {
  [Kind in MachineStatusKind]: {
    readonly opcode: number;
    readonly kind: Kind;
    /** Original bytes, including values reserved for future use. */
    readonly parameters: Uint8Array;
    /** Present for known parameter-bearing statuses parsed by this library. */
    readonly decodedParameters?: MachineStatusParameters[Kind];
  };
}[MachineStatusKind];

export type SpinDownControl = "start" | "ignore";

/** Command acceptance and target speed window; completion arrives in Machine Status. */
export interface SpinDownResponse extends ControlPointResponse {
  readonly targetSpeedLowKph: number;
  readonly targetSpeedHighKph: number;
}

export type CommandPhase =
  "queued" | "sent" | "acknowledged" | "rejected" | "timedout" | "superseded" | "cancelled";

export interface CommandEvent {
  /** Monotonically increasing for the lifetime of this trainer, including reconnects. */
  readonly id: number;
  readonly opcode: number;
  readonly phase: CommandPhase;
  /** Monotonic milliseconds since this command was queued. */
  readonly elapsedMs: number;
  /** Monotonic milliseconds since dispatch to the transport, when dispatched. */
  readonly latencyMs?: number;
  readonly resultCode?: number;
  readonly errorCode?: string;
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

/** FTMS 1.0 used UINT8; FTMS 1.0.1 corrected target resistance to SINT16. */
export type ResistanceControlFormat = "sint16" | "uint8";

export interface TrainerOptions {
  commandTimeoutMs?: number;
  autoStartTelemetry?: boolean;
  /** Enforce characteristics required by advertised FTMS capabilities. Defaults to true. */
  strictProtocol?: boolean;
  /** Defaults to the FTMS 1.0.1 SINT16 format. Use `uint8` only for legacy FTMS 1.0 devices. */
  resistanceControlFormat?: ResistanceControlFormat;
}

export interface Trainer {
  readonly deviceName: string | undefined;
  readonly connection: StateValue<TrainerConnectionState>;
  readonly control: StateValue<TrainerControlState>;
  readonly activity: StateValue<TrainerActivityState>;
  readonly capabilities: StateValue<TrainerCapabilities | null>;
  readonly telemetry: StateValue<TrainerTelemetry | null>;
  readonly controlResponses: Stream<ControlPointResponse>;
  readonly commandEvents: Stream<CommandEvent>;
  /** Raw Machine Status bytes, retained for protocol extensions and diagnostics. */
  readonly machineStatus: Stream<Uint8Array>;
  /** Parsed lifecycle statuses. Unknown opcodes are preserved rather than discarded. */
  readonly machineStatusEvents: Stream<MachineStatus>;
  readonly errors: Stream<Error>;

  connect(): Promise<TrainerCapabilities>;
  disconnect(): Promise<void>;
  acquireControl(): Promise<ControlPointResponse>;
  start(): Promise<ControlPointResponse>;
  pause(): Promise<ControlPointResponse>;
  stop(): Promise<ControlPointResponse>;
  reset(): Promise<ControlPointResponse>;
  setTargetPower(watts: number): Promise<ControlPointResponse>;
  setTargetCadence(rpm: number): Promise<ControlPointResponse>;
  spinDown(control: SpinDownControl): Promise<SpinDownResponse>;
  setResistanceLevel(level: number): Promise<ControlPointResponse>;
  setSimulation(parameters: SimulationParameters): Promise<ControlPointResponse>;
}
