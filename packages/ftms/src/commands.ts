import { FtmsRangeError } from "./errors.js";
import type { ResistanceControlFormat, SimulationParameters } from "./types.js";

export const CONTROL_OPCODE = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetResistance: 0x04,
  setTargetPower: 0x05,
  startResume: 0x07,
  stopPause: 0x08,
  setSimulation: 0x11,
} as const;

function assertIntegerRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new FtmsRangeError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
}

export function requestControlCommand(): Uint8Array {
  return Uint8Array.of(CONTROL_OPCODE.requestControl);
}

export function resetCommand(): Uint8Array {
  return Uint8Array.of(CONTROL_OPCODE.reset);
}

export function startCommand(): Uint8Array {
  return Uint8Array.of(CONTROL_OPCODE.startResume);
}

export function stopCommand(): Uint8Array {
  return Uint8Array.of(CONTROL_OPCODE.stopPause, 0x01);
}

export function pauseCommand(): Uint8Array {
  return Uint8Array.of(CONTROL_OPCODE.stopPause, 0x02);
}

export function targetPowerCommand(watts: number): Uint8Array {
  const rounded = Math.round(watts);
  assertIntegerRange(rounded, -32768, 32767, "Target power");
  const bytes = new Uint8Array(3);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, CONTROL_OPCODE.setTargetPower);
  view.setInt16(1, rounded, true);
  return bytes;
}

export function targetResistanceCommand(
  level: number,
  format: ResistanceControlFormat = "sint16",
): Uint8Array {
  const encoded = Math.round(level * 10);
  if (format === "uint8") {
    assertIntegerRange(encoded, 0, 255, "Encoded resistance level");
    return Uint8Array.of(CONTROL_OPCODE.setTargetResistance, encoded);
  }
  assertIntegerRange(encoded, -32768, 32767, "Encoded resistance level");
  const bytes = new Uint8Array(3);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, CONTROL_OPCODE.setTargetResistance);
  view.setInt16(1, encoded, true);
  return bytes;
}

export function simulationCommand(parameters: SimulationParameters): Uint8Array {
  const windSpeed = Math.round((parameters.windSpeedMps ?? 0) * 1000);
  const grade = Math.round(parameters.gradePercent * 100);
  const rollingResistance = Math.round((parameters.rollingResistance ?? 0.004) * 10_000);
  const windResistance = Math.round((parameters.windResistanceKgPerM ?? 0.51) * 100);

  assertIntegerRange(windSpeed, -32768, 32767, "Encoded wind speed");
  assertIntegerRange(grade, -32768, 32767, "Encoded grade");
  assertIntegerRange(rollingResistance, 0, 255, "Encoded rolling resistance");
  assertIntegerRange(windResistance, 0, 255, "Encoded wind resistance");

  const bytes = new Uint8Array(7);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, CONTROL_OPCODE.setSimulation);
  view.setInt16(1, windSpeed, true);
  view.setInt16(3, grade, true);
  view.setUint8(5, rollingResistance);
  view.setUint8(6, windResistance);
  return bytes;
}
