import { describe, expect, it } from "vitest";
import { analyzeRide } from "../src/analysis";
import type { RideRecord, RideSample } from "../src/ride";

function record(samples: RideSample[], overrides: Partial<RideRecord> = {}): RideRecord {
  return {
    version: 1,
    startedAt: "2026-09-27T12:00:00Z",
    name: "Analysis test",
    simulator: false,
    seconds: 30,
    distanceKm: 0,
    averagePower: null,
    workKj: 0,
    completed: false,
    samples,
    ...overrides,
  };
}
function sample(
  seconds: number,
  watts: number | null,
  cadence: number | null,
  target = 100,
): RideSample {
  return { seconds, watts, cadence, target, speed: null };
}

describe("ride analysis", () => {
  it("weights measured intervals, excludes gaps and duplicate timestamps, and keeps real zero readings", () => {
    const analysis = analyzeRide(
      record([
        sample(1, 100, 80),
        sample(3, 200, 100, 200),
        sample(4, null, null),
        sample(10, 500, 200),
        sample(12, 0, 0),
        sample(12, 500, 200),
        sample(13, 210, 90, 200),
      ]),
    );
    expect(analysis.measuredSeconds).toBe(6);
    expect(analysis.zones).toEqual([3, 0, 0, 3, 0, 0, 0]);
    expect(analysis.zones.reduce((sum, seconds) => sum + seconds, 0)).toBe(
      analysis.measuredSeconds,
    );
    expect(analysis.peakPower).toBe(210);
    expect(analysis.targetSeconds).toBe(6);
    expect(analysis.onTargetSeconds).toBe(4);
    expect(analysis.targetError).toBeCloseTo(210 / 6);
    expect(analysis.cadenceMean).toBeCloseTo(370 / 6);
    expect(analysis.cadenceDeviation).toBeCloseTo(Math.sqrt(34500 / 6 - (370 / 6) ** 2));
  });

  it("uses FTP boundaries for all seven power zones", () => {
    const analysis = analyzeRide(
      record(
        [110, 150, 180, 210, 240, 300, 301].map((watts, index) => sample(index + 1, watts, null)),
      ),
      200,
    );
    expect(analysis.zones).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it("separates no data from measured zero and calculates cadence without power", () => {
    const missing = analyzeRide(record([sample(1, null, null)]));
    expect(missing).toMatchObject({
      measuredSeconds: 0,
      peakPower: null,
      targetError: null,
      cadenceMean: null,
      cadenceDeviation: null,
    });
    const zero = analyzeRide(record([sample(1, 0, 0)]));
    expect(zero).toMatchObject({
      measuredSeconds: 1,
      peakPower: 0,
      cadenceMean: 0,
      cadenceDeviation: 0,
      targetError: 100,
    });
    const cadence = analyzeRide(record([sample(1, null, 50), sample(4, null, 100)]));
    expect(cadence.measuredSeconds).toBe(0);
    expect(cadence.cadenceMean).toBe(87.5);
    expect(cadence.cadenceDeviation).toBeCloseTo(Math.sqrt(468.75));
  });

  it.each(["resistance", "terrain"] as const)(
    "does not interpret a %s level as an ERG target",
    (controlMode) => {
      const analysis = analyzeRide(record([sample(1, 100, 80, 100)], { controlMode }));
      expect(analysis.measuredSeconds).toBe(1);
      expect(analysis.peakPower).toBe(100);
      expect(analysis.targetSeconds).toBe(0);
      expect(analysis.onTargetSeconds).toBe(0);
      expect(analysis.targetError).toBeNull();
    },
  );

  it("supports legacy ERG records and excludes steps with a zero target from target accuracy", () => {
    const analysis = analyzeRide(record([sample(1, 99, 80), sample(2, 0, 80, 0)]));
    expect(analysis.measuredSeconds).toBe(2);
    expect(analysis.targetSeconds).toBe(1);
    expect(analysis.onTargetSeconds).toBe(1);
    expect(analysis.targetError).toBe(1);
  });

  it.each([0, 24, 601, NaN, Infinity])("rejects invalid FTP %s", (ftp) => {
    expect(() => analyzeRide(record([]), ftp)).toThrow(/FTP/);
  });
});
