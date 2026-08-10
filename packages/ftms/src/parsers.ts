import { FtmsProtocolError } from "./errors.js";
import type {
  ControlPointResponse,
  MachineStatus,
  TrainerCapabilities,
  TrainerTelemetry,
  ValueRange,
} from "./types.js";

const MACHINE_STATUS_KIND: Readonly<Record<number, MachineStatus["kind"]>> = {
  0x01: "reset",
  0x02: "stopped-or-paused-by-user",
  0x03: "stopped-by-safety-key",
  0x04: "started-or-resumed-by-user",
  0x05: "target-speed-changed",
  0x06: "target-inclination-changed",
  0x07: "target-resistance-changed",
  0x08: "target-power-changed",
  0x09: "target-heart-rate-changed",
  0x0a: "target-energy-changed",
  0x0b: "target-steps-changed",
  0x0c: "target-strides-changed",
  0x0d: "target-distance-changed",
  0x0e: "target-training-time-changed",
  0x0f: "target-time-two-heart-rate-zones-changed",
  0x10: "target-time-three-heart-rate-zones-changed",
  0x11: "target-time-five-heart-rate-zones-changed",
  0x12: "simulation-parameters-changed",
  0x13: "wheel-circumference-changed",
  0x14: "spin-down-status",
  0xff: "control-permission-lost",
};

const MACHINE_FEATURE = {
  cadence: 1 << 1,
  resistanceLevel: 1 << 7,
  powerMeasurement: 1 << 14,
} as const;

const TARGET_FEATURE = {
  resistance: 1 << 2,
  power: 1 << 3,
  simulation: 1 << 13,
  spindown: 1 << 15,
  targetCadence: 1 << 16,
} as const;

function assertAvailable(view: DataView, offset: number, length: number, field: string): void {
  if (offset + length > view.byteLength) {
    throw new FtmsProtocolError(`Indoor Bike Data ended while reading ${field} at byte ${offset}.`);
  }
}

function readUint24(view: DataView, offset: number): number {
  return (
    view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16)
  );
}

export function parseIndoorBikeData(view: DataView, timestamp = Date.now()): TrainerTelemetry {
  assertAvailable(view, 0, 2, "flags");
  const flags = view.getUint16(0, true);
  let offset = 2;
  const result: TrainerTelemetry = { timestamp };

  const uint16 = (field: string): number => {
    assertAvailable(view, offset, 2, field);
    const value = view.getUint16(offset, true);
    offset += 2;
    return value;
  };

  const int16 = (field: string): number => {
    assertAvailable(view, offset, 2, field);
    const value = view.getInt16(offset, true);
    offset += 2;
    return value;
  };

  const uint8 = (field: string): number => {
    assertAvailable(view, offset, 1, field);
    const value = view.getUint8(offset);
    offset += 1;
    return value;
  };

  // FTMS's "More Data" flag is inverted: speed is present when bit 0 is clear.
  if ((flags & (1 << 0)) === 0) result.instantaneousSpeedKph = uint16("speed") / 100;
  if (flags & (1 << 1)) result.averageSpeedKph = uint16("average speed") / 100;
  if (flags & (1 << 2)) result.instantaneousCadenceRpm = uint16("cadence") / 2;
  if (flags & (1 << 3)) result.averageCadenceRpm = uint16("average cadence") / 2;

  if (flags & (1 << 4)) {
    assertAvailable(view, offset, 3, "total distance");
    result.totalDistanceMeters = readUint24(view, offset);
    offset += 3;
  }

  if (flags & (1 << 5)) result.resistanceLevel = int16("resistance level") / 10;
  if (flags & (1 << 6)) result.instantaneousPowerWatts = int16("instantaneous power");
  if (flags & (1 << 7)) result.averagePowerWatts = int16("average power");

  if (flags & (1 << 8)) {
    result.totalEnergyKcal = uint16("total energy");
    result.energyPerHourKcal = uint16("energy per hour");
    result.energyPerMinuteKcal = uint8("energy per minute");
  }

  if (flags & (1 << 9)) result.heartRateBpm = uint8("heart rate");
  if (flags & (1 << 10)) result.metabolicEquivalent = uint8("metabolic equivalent") / 10;
  if (flags & (1 << 11)) result.elapsedTimeSeconds = uint16("elapsed time");
  if (flags & (1 << 12)) result.remainingTimeSeconds = uint16("remaining time");

  return result;
}

export function parseCapabilities(view: DataView): TrainerCapabilities {
  if (view.byteLength !== 8) {
    throw new FtmsProtocolError(`Fitness Machine Feature must be 8 bytes; got ${view.byteLength}.`);
  }

  const machineFeatures = view.getUint32(0, true);
  const targetSettingFeatures = view.getUint32(4, true);

  return {
    machineFeatures,
    targetSettingFeatures,
    supportsCadence: Boolean(machineFeatures & MACHINE_FEATURE.cadence),
    supportsResistanceMeasurement: Boolean(machineFeatures & MACHINE_FEATURE.resistanceLevel),
    supportsPowerMeasurement: Boolean(machineFeatures & MACHINE_FEATURE.powerMeasurement),
    supportsResistanceTarget: Boolean(targetSettingFeatures & TARGET_FEATURE.resistance),
    supportsPowerTarget: Boolean(targetSettingFeatures & TARGET_FEATURE.power),
    supportsSimulation: Boolean(targetSettingFeatures & TARGET_FEATURE.simulation),
    supportsSpindown: Boolean(targetSettingFeatures & TARGET_FEATURE.spindown),
    supportsTargetCadence: Boolean(targetSettingFeatures & TARGET_FEATURE.targetCadence),
  };
}

export function parseSupportedPowerRange(view: DataView): ValueRange {
  if (view.byteLength !== 6) {
    throw new FtmsProtocolError(`Supported Power Range must be 6 bytes; got ${view.byteLength}.`);
  }

  return {
    minimum: view.getInt16(0, true),
    maximum: view.getInt16(2, true),
    increment: view.getUint16(4, true),
  };
}

export function parseSupportedResistanceRange(view: DataView): ValueRange {
  if (view.byteLength !== 6) {
    throw new FtmsProtocolError(
      `Supported Resistance Level Range must be 6 bytes; got ${view.byteLength}.`,
    );
  }

  return {
    minimum: view.getInt16(0, true) / 10,
    maximum: view.getInt16(2, true) / 10,
    increment: view.getUint16(4, true) / 10,
  };
}

export function parseControlPointResponse(view: DataView): ControlPointResponse {
  if (view.byteLength < 3 || view.getUint8(0) !== 0x80) {
    throw new FtmsProtocolError("Invalid Fitness Machine Control Point response.");
  }

  return {
    responseOpcode: 0x80,
    requestOpcode: view.getUint8(1),
    resultCode: view.getUint8(2),
    responseParameters: new Uint8Array(
      view.buffer.slice(view.byteOffset + 3, view.byteOffset + view.byteLength),
    ),
  };
}

export function parseMachineStatus(view: DataView): MachineStatus {
  if (view.byteLength < 1) {
    throw new FtmsProtocolError("Fitness Machine Status must contain at least 1 byte.");
  }
  const opcode = view.getUint8(0);
  if (opcode === 0x02 && view.byteLength < 2) {
    throw new FtmsProtocolError("Fitness Machine Status 0x02 requires a stop-or-pause parameter.");
  }
  return {
    opcode,
    kind: MACHINE_STATUS_KIND[opcode] ?? "unknown",
    parameters: new Uint8Array(
      view.buffer.slice(view.byteOffset + 1, view.byteOffset + view.byteLength),
    ),
  };
}
