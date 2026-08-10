import { describe, expect, it } from "vitest";
import {
  simulationCommand,
  targetPowerCommand,
  targetResistanceCommand,
} from "../src/raw.js";

describe("FTMS command encoding", () => {
  it("encodes signed little-endian ERG power", () => {
    expect([...targetPowerCommand(200)]).toEqual([0x05, 0xc8, 0x00]);
    expect([...targetPowerCommand(-20)]).toEqual([0x05, 0xec, 0xff]);
  });

  it("encodes resistance with 0.1 resolution", () => {
    expect([...targetResistanceCommand(10)]).toEqual([0x04, 100]);
    expect([...targetResistanceCommand(5.5)]).toEqual([0x04, 55]);
  });

  it("encodes indoor bike simulation parameters", () => {
    expect([
      ...simulationCommand({
        windSpeedMps: -1.5,
        gradePercent: 4.25,
        rollingResistance: 0.004,
        windResistanceKgPerM: 0.51,
      }),
    ]).toEqual([0x11, 0x24, 0xfa, 0xa9, 0x01, 40, 51]);
  });
});
