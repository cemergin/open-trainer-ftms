import { describe, expect, it } from "vitest";
import { simulationCommand, targetPowerCommand, targetResistanceCommand } from "../src/raw.js";

describe("FTMS command encoding", () => {
  it("encodes signed little-endian ERG power", () => {
    expect([...targetPowerCommand(200)]).toEqual([0x05, 0xc8, 0x00]);
    expect([...targetPowerCommand(-20)]).toEqual([0x05, 0xec, 0xff]);
  });

  it("encodes resistance with 0.1 resolution", () => {
    expect([...targetResistanceCommand(10)]).toEqual([0x04, 0x64, 0x00]);
    expect([...targetResistanceCommand(5.5)]).toEqual([0x04, 0x37, 0x00]);
    expect([...targetResistanceCommand(-1)]).toEqual([0x04, 0xf6, 0xff]);
  });

  it("supports the legacy FTMS 1.0 UINT8 resistance command", () => {
    expect([...targetResistanceCommand(10, "uint8")]).toEqual([0x04, 0x64]);
    expect(() => targetResistanceCommand(-1, "uint8")).toThrow(/0 to 255/);
  });

  it("rejects values outside the control-point field", () => {
    expect(() => targetResistanceCommand(3_276.8)).toThrow(/-32768 to 32767/);
    expect(() => targetPowerCommand(Number.NaN)).toThrow(/-32768 to 32767/);
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
