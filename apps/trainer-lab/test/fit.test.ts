import { Decoder, Stream } from "@garmin/fitsdk";
import { describe, expect, it } from "vitest";
import { rideFit } from "../src/services/fit";
import type { RideRecord } from "../src/ride";

const ride: RideRecord = {
  version: 1,
  startedAt: "2026-09-27T12:00:00.000Z",
  name: "Morning intervals",
  simulator: false,
  seconds: 60,
  distanceKm: 0.5,
  averagePower: 150,
  workKj: 9,
  completed: true,
  samples: [
    { seconds: 1, watts: 125, cadence: 85, speed: 18, target: 150 },
    { seconds: 30, watts: null, cadence: null, speed: null, target: 150 },
    { seconds: 60, watts: 175, cadence: 90, speed: 36, target: 150 },
  ],
};

function decode(record: RideRecord): ReturnType<Decoder["read"]>["messages"] {
  const bytes = rideFit(record);
  const decoder = new Decoder(Stream.fromArrayBuffer(bytes.buffer));
  expect(decoder.isFIT()).toBe(true);
  expect(decoder.checkIntegrity()).toBe(true);
  const decoded = decoder.read();
  expect(decoded.errors).toEqual([]);
  return decoded.messages;
}

describe("FIT activity export", () => {
  it("produces an SDK-decodable cycling activity with record, lap, session, and activity totals", () => {
    const messages = decode(ride);
    expect(messages.fileIdMesgs?.[0]?.type).toBe("activity");
    expect(messages.recordMesgs).toHaveLength(3);
    expect(messages.recordMesgs?.[0]).toMatchObject({
      timestamp: new Date("2026-09-27T12:00:01Z"),
      power: 125,
      cadence: 85,
      speed: 5,
    });
    expect(messages.recordMesgs?.[2]).toMatchObject({
      timestamp: new Date("2026-09-27T12:01:00Z"),
      power: 175,
      speed: 10,
    });
    for (const summary of [messages.lapMesgs?.[0], messages.sessionMesgs?.[0]]) {
      expect(summary).toMatchObject({
        sport: "cycling",
        subSport: "indoorCycling",
        totalElapsedTime: 60,
        totalTimerTime: 60,
        totalDistance: 500,
        totalWork: 9000,
        avgPower: 150,
        maxPower: 175,
        startTime: new Date(ride.startedAt),
        timestamp: new Date("2026-09-27T12:01:00Z"),
      });
    }
    expect(messages.sessionMesgs?.[0]).toMatchObject({ firstLapIndex: 0, numLaps: 1 });
    expect(messages.activityMesgs?.[0]).toMatchObject({ numSessions: 1, totalTimerTime: 60 });
    expect(messages.eventMesgs?.map((event) => event.eventType)).toEqual(["start", "stopAll"]);
  });
  it("omits unavailable metrics and target power rather than exporting them as measurements", () => {
    const messages = decode(ride);
    const missing = messages.recordMesgs?.[1];
    expect(missing).not.toHaveProperty("power");
    expect(missing).not.toHaveProperty("cadence");
    expect(missing).not.toHaveProperty("speed");
    expect(missing).not.toHaveProperty("heartRate");
    expect(missing).not.toHaveProperty("distance");
  });
  it("maps optional heart rate, distance and grade without assuming FIT resistance units", () => {
    const sample = {
      ...ride.samples[0],
      seconds: 1,
      watts: 100,
      cadence: 80,
      speed: 18,
      target: 100,
      heartRate: 145,
      distanceKm: 0.01,
      grade: -2.5,
      resistance: 30,
    };
    const messages = decode({ ...ride, samples: [sample] });
    expect(messages.recordMesgs?.[0]).toMatchObject({ heartRate: 145, distance: 10, grade: -2.5 });
    expect(messages.recordMesgs?.[0]).not.toHaveProperty("resistance");
  });
  it("retains fractional duration in the summaries and handles a ride with no telemetry", () => {
    const messages = decode({
      ...ride,
      seconds: 1.25,
      samples: [],
      averagePower: null,
      workKj: 0,
      distanceKm: 0,
    });
    expect(messages.activityMesgs?.[0]?.totalTimerTime).toBe(1.25);
    expect(messages.sessionMesgs?.[0]).not.toHaveProperty("avgPower");
    expect(messages.sessionMesgs?.[0]).not.toHaveProperty("totalWork");
    expect(messages.sessionMesgs?.[0]).not.toHaveProperty("totalDistance");
    expect(messages.recordMesgs).toHaveLength(1);
    expect(messages.recordMesgs?.[0]).not.toHaveProperty("power");
  });
  it("keeps real zero measurements and omits non-finite or out-of-range readings", () => {
    const zero = decode({
      ...ride,
      seconds: 1,
      workKj: 0,
      distanceKm: 0,
      averagePower: 0,
      samples: [{ seconds: 1, watts: 0, cadence: 0, speed: 0, target: 100 }],
    });
    expect(zero.recordMesgs?.[0]).toMatchObject({ power: 0, cadence: 0, speed: 0 });
    expect(zero.sessionMesgs?.[0]).toMatchObject({ avgPower: 0, totalWork: 0, totalDistance: 0 });
    const invalid = decode({
      ...ride,
      samples: [{ seconds: 1, watts: -5, cadence: Infinity, speed: NaN, target: 100 }],
    });
    expect(invalid.recordMesgs?.[0]).not.toHaveProperty("power");
    expect(invalid.recordMesgs?.[0]).not.toHaveProperty("cadence");
    expect(invalid.recordMesgs?.[0]).not.toHaveProperty("speed");
  });
  it("rejects invalid timelines and totals before encoding", () => {
    expect(() => rideFit({ ...ride, startedAt: "bad" })).toThrow(/timing/);
    expect(() => rideFit({ ...ride, seconds: -1 })).toThrow(/timing/);
    expect(() => rideFit({ ...ride, samples: [...ride.samples].reverse() })).toThrow(/timestamps/);
    expect(() => rideFit({ ...ride, distanceKm: Infinity })).toThrow(/totals/);
  });
});
