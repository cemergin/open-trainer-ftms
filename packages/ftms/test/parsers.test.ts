import { describe, expect, it } from "vitest";
import {
  parseCapabilities,
  parseMachineStatus,
  parseIndoorBikeData,
  parseSupportedPowerRange,
  parseSupportedResistanceRange,
} from "../src/raw.js";

describe("parseIndoorBikeData", () => {
  it("parses every optional Indoor Bike Data field in FTMS order", () => {
    const bytes = new Uint8Array(30);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 0x1ffe, true);
    let offset = 2;
    view.setUint16(offset, 3_245, true);
    offset += 2;
    view.setUint16(offset, 3_100, true);
    offset += 2;
    view.setUint16(offset, 176, true);
    offset += 2;
    view.setUint16(offset, 170, true);
    offset += 2;
    view.setUint8(offset, 0x34);
    view.setUint8(offset + 1, 0x12);
    view.setUint8(offset + 2, 0x01);
    offset += 3;
    view.setInt16(offset, 120, true);
    offset += 2;
    view.setInt16(offset, 247, true);
    offset += 2;
    view.setInt16(offset, 231, true);
    offset += 2;
    view.setUint16(offset, 320, true);
    offset += 2;
    view.setUint16(offset, 740, true);
    offset += 2;
    view.setUint8(offset, 12);
    offset += 1;
    view.setUint8(offset, 151);
    offset += 1;
    view.setUint8(offset, 87);
    offset += 1;
    view.setUint16(offset, 901, true);
    offset += 2;
    view.setUint16(offset, 99, true);

    expect(parseIndoorBikeData(view, 1234)).toEqual({
      timestamp: 1234,
      instantaneousSpeedKph: 32.45,
      averageSpeedKph: 31,
      instantaneousCadenceRpm: 88,
      averageCadenceRpm: 85,
      totalDistanceMeters: 70_196,
      resistanceLevel: 12,
      instantaneousPowerWatts: 247,
      averagePowerWatts: 231,
      totalEnergyKcal: 320,
      energyPerHourKcal: 740,
      energyPerMinuteKcal: 12,
      heartRateBpm: 151,
      metabolicEquivalent: 8.7,
      elapsedTimeSeconds: 901,
      remainingTimeSeconds: 99,
    });
  });

  it("honors the inverted More Data bit", () => {
    const bytes = Uint8Array.of(0x01, 0x00);
    expect(parseIndoorBikeData(new DataView(bytes.buffer), 1)).toEqual({ timestamp: 1 });
  });
});

describe("feature and range parsing", () => {
  it("decodes machine and target-setting capabilities", () => {
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, (1 << 1) | (1 << 7) | (1 << 14), true);
    view.setUint32(4, (1 << 2) | (1 << 3) | (1 << 13) | (1 << 16), true);
    expect(parseCapabilities(view)).toMatchObject({
      supportsCadence: true,
      supportsResistanceMeasurement: true,
      supportsPowerMeasurement: true,
      supportsResistanceTarget: true,
      supportsPowerTarget: true,
      supportsSimulation: true,
      supportsSpindown: false,
      supportsTargetCadence: true,
    });
  });

  it("decodes signed power and resistance ranges", () => {
    const power = new Uint8Array(6);
    const powerView = new DataView(power.buffer);
    powerView.setInt16(0, -100, true);
    powerView.setInt16(2, 1800, true);
    powerView.setUint16(4, 5, true);
    expect(parseSupportedPowerRange(powerView)).toEqual({
      minimum: -100,
      maximum: 1800,
      increment: 5,
    });
    const resistance = new Uint8Array(6);
    const resistanceView = new DataView(resistance.buffer);
    resistanceView.setInt16(0, -100, true);
    resistanceView.setInt16(2, 200, true);
    resistanceView.setUint16(4, 5, true);
    expect(parseSupportedResistanceRange(resistanceView)).toEqual({
      minimum: -10,
      maximum: 20,
      increment: 0.5,
    });
  });

  it("rejects non-conformant fixed-length characteristics", () => {
    expect(() => parseCapabilities(new DataView(new ArrayBuffer(9)))).toThrow(/must be 8 bytes/);
    expect(() => parseSupportedPowerRange(new DataView(new ArrayBuffer(5)))).toThrow(
      /must be 6 bytes/,
    );
    expect(() => parseSupportedResistanceRange(new DataView(new ArrayBuffer(3)))).toThrow(
      /must be 6 bytes/,
    );
  });
});

describe("parseMachineStatus", () => {
  it("returns a typed lifecycle status while preserving parameters", () => {
    expect(parseMachineStatus(new DataView(Uint8Array.of(0x02, 0x02).buffer))).toEqual({
      opcode: 0x02,
      kind: "stopped-or-paused-by-user",
      parameters: Uint8Array.of(0x02),
    });
  });

  it("preserves unknown status opcodes for forward compatibility", () => {
    expect(parseMachineStatus(new DataView(Uint8Array.of(0x7e, 0xaa).buffer))).toEqual({
      opcode: 0x7e,
      kind: "unknown",
      parameters: Uint8Array.of(0xaa),
    });
  });

  it("rejects an empty status packet", () => {
    expect(() => parseMachineStatus(new DataView(new ArrayBuffer(0)))).toThrow(/at least 1 byte/);
  });
});
