import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RideRecord } from "../src/ride";
import type { SensorSourceSnapshot } from "../src/services/sensors";
import {
  BACKUP_BYTE_LIMIT,
  deleteRide,
  exportAllData,
  importRideBackup,
  listRides,
  loadCheckpoint,
  rideCsv,
  saveCheckpoint,
  saveRide,
  type RideCheckpoint,
} from "../src/services/storage";

const KEY = "open-trainer:rides:v2";
const trainerSources: SensorSourceSnapshot = {
  power: { source: "trainer", sensorName: null, simulator: null },
  cadence: { source: "trainer", sensorName: null, simulator: null },
  heartRate: { source: "none", sensorName: null, simulator: null },
};
const externalSources: SensorSourceSnapshot = {
  power: { source: "external", sensorName: "Power meter", simulator: false },
  cadence: { source: "external", sensorName: "Cadence sensor", simulator: false },
  heartRate: { source: "external", sensorName: "Heart rate strap", simulator: false },
};
const record: RideRecord = {
  version: 1,
  startedAt: "2026-09-27T12:00:00.000Z",
  name: "Saved ramp",
  simulator: false,
  seconds: 2,
  distanceKm: 0.02,
  averagePower: 100,
  workKj: 0.2,
  measuredSeconds: 2,
  completed: false,
  samples: [
    { seconds: 1, watts: 100, cadence: 80, speed: 36, target: 100, distanceKm: 0.01 },
    { seconds: 2, watts: 100, cadence: 85, speed: 36, target: 110, distanceKm: 0.02 },
  ],
};
const checkpoint: RideCheckpoint = {
  version: 1,
  savedAt: "2026-09-27T12:00:02.000Z",
  adjustment: 5,
  workout: {
    name: record.name,
    seconds: 40,
    steps: [
      { name: "Ramp", seconds: 20, watts: 100, endWatts: 200, cadenceRpm: 90, effort: "hard" },
      { name: "Recovery", seconds: 20, watts: 75, effort: "easy" },
    ],
  },
  record: {
    ...record,
    workoutElapsed: 21,
    controlMode: "terrain",
    routeId: "rolling-v1",
    controlTarget: -1,
  },
};
let stored: Map<string, string>;
let setItem: ReturnType<typeof vi.fn>;
beforeEach(() => {
  stored = new Map();
  setItem = vi.fn((key: string, value: string) => {
    stored.set(key, value);
  });
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem });
});
afterEach(() => vi.unstubAllGlobals());

function backup(rides: unknown[], recovery: unknown = null): string {
  return JSON.stringify({ version: 2, rides, checkpoint: recovery });
}

describe("transactional ride backup imports", () => {
  it("round trips a checkpoint's mixed sensor source history", () => {
    const recovery: RideCheckpoint = {
      ...checkpoint,
      record: {
        ...checkpoint.record,
        sourceChanges: [
          { seconds: 0, sources: trainerSources },
          { seconds: 1.5, sources: externalSources },
        ],
      },
    };
    expect(saveCheckpoint(recovery)).toBe(true);
    const exported = exportAllData();
    stored.clear();
    expect(importRideBackup(exported).recovered).toBe(true);
    expect(loadCheckpoint()).toEqual(recovery);
  });

  it.each([
    {
      seconds: 0,
      sources: { ...externalSources, power: { ...externalSources.power, source: "unknown" } },
    },
    {
      seconds: 0,
      sources: { ...externalSources, cadence: { ...externalSources.cadence, simulator: "false" } },
    },
    {
      seconds: 0,
      sources: { ...externalSources, heartRate: { ...externalSources.heartRate, sensorName: 123 } },
    },
    { seconds: 3, sources: externalSources },
    { seconds: -1, sources: externalSources },
  ])("rejects an invalid source mixed into otherwise valid backup history", (invalid) => {
    saveCheckpoint(checkpoint);
    const before = stored.get(KEY);
    setItem.mockClear();
    expect(() =>
      importRideBackup(
        backup([{ ...record, sourceChanges: [{ seconds: 0, sources: trainerSources }, invalid] }]),
      ),
    ).toThrow();
    expect(setItem).not.toHaveBeenCalled();
    expect(stored.get(KEY)).toBe(before);
  });

  it("rejects out-of-order source changes transactionally", () => {
    saveCheckpoint(checkpoint);
    const before = stored.get(KEY);
    expect(() =>
      importRideBackup(
        backup([
          {
            ...record,
            sourceChanges: [
              { seconds: 1, sources: trainerSources },
              { seconds: 0, sources: externalSources },
            ],
          },
        ]),
      ),
    ).toThrow();
    expect(stored.get(KEY)).toBe(before);
  });

  it("exports sensor selection changes, HR and grade with truthful non-ERG target values", () => {
    const csv = rideCsv({
      ...record,
      controlMode: "terrain",
      routeId: "rolling-v1",
      sourceChanges: [
        { seconds: 0, sources: trainerSources },
        { seconds: 1.5, sources: externalSources },
      ],
      samples: record.samples.map((sample) => ({
        ...sample,
        target: 0,
        heartRate: 145,
        grade: -2.5,
      })),
    });
    const [header, ...lines] = csv.split("\n").map((line) => line.split(","));
    if (!header) throw new Error("CSV header is required.");
    const rows = lines.map((line) =>
      Object.fromEntries(header.map((key, index) => [key, line[index]])),
    );
    expect(rows[0]).toMatchObject({
      power_source: "trainer",
      cadence_source: "trainer",
      heart_rate_source: "none",
      target_watts: "0",
      grade_percent: "-2.5",
      heart_rate_bpm: "145",
      distance_km: "0.01",
      control_mode: "terrain",
    });
    expect(rows[1]).toMatchObject({
      power_source: "external",
      cadence_source: "external",
      heart_rate_source: "external",
    });
    const resistanceCsv = rideCsv({
      ...record,
      controlMode: "resistance",
      sourceChanges: [{ seconds: 0, sources: trainerSources }],
      samples: record.samples.map((sample) => ({ ...sample, resistance: 7, target: 0 })),
    });
    expect(resistanceCsv.split("\n")[1]?.split(",")[10]).toBe("7");
  });

  it("includes extended measurements even when an imported record has no source history", () => {
    const csv = rideCsv({
      ...record,
      controlMode: "resistance",
      samples: record.samples.map((sample) => ({ ...sample, resistance: 7, target: 0 })),
    });
    expect(csv.split("\n")[0]).toContain("resistance_level");
  });
  it("merges new rides while preserving a longer local recording of the same activity", () => {
    expect(saveRide({ ...record, seconds: 20 })).toBe(true);
    const other = { ...record, startedAt: "2026-09-28T12:00:00.000Z" };
    expect(importRideBackup(backup([record, other]))).toEqual({
      imported: 1,
      total: 2,
      recovered: false,
    });
    expect(listRides().find((ride) => ride.startedAt === record.startedAt)?.seconds).toBe(20);
    expect(listRides()[0]).toEqual(other);
    expect(importRideBackup(backup([{ ...record, seconds: 30 }]))).toEqual({
      imported: 1,
      total: 2,
      recovered: false,
    });
    expect(listRides().find((ride) => ride.startedAt === record.startedAt)?.seconds).toBe(30);
  });

  it("prefers a completed equal-duration record and never downgrades it to unfinished", () => {
    saveRide(record);
    expect(importRideBackup(backup([{ ...record, completed: true }])).imported).toBe(1);
    expect(importRideBackup(backup([record])).imported).toBe(0);
    expect(listRides()[0]?.completed).toBe(true);
  });

  it("keeps an active local checkpoint and its history record ahead of incoming replacements", () => {
    expect(saveCheckpoint(checkpoint)).toBe(true);
    const before = loadCheckpoint();
    const incomingCheckpoint = {
      ...checkpoint,
      record: { ...checkpoint.record, startedAt: "2026-09-28T12:00:00.000Z" },
    };
    const result = importRideBackup(
      backup([{ ...record, seconds: 200, completed: true }], incomingCheckpoint),
    );
    expect(result.recovered).toBe(false);
    expect(loadCheckpoint()).toEqual(before);
    expect(listRides().find((ride) => ride.startedAt === record.startedAt)).toEqual(
      checkpoint.record,
    );
    expect(() => deleteRide(record.startedAt)).toThrow(/unfinished/);
  });

  it("restores ramps, cadence, control mode, and separate workout position from a valid export", () => {
    expect(saveCheckpoint(checkpoint)).toBe(true);
    const exported = exportAllData();
    stored.clear();
    const result = importRideBackup(exported);
    expect(result.recovered).toBe(true);
    expect(loadCheckpoint()).toEqual(checkpoint);
    expect(listRides()[0]).toEqual(checkpoint.record);
  });

  it("does not revive a recovery older than a completed or longer local activity", () => {
    saveRide({ ...record, completed: true });
    expect(importRideBackup(backup([], checkpoint)).recovered).toBe(false);
    expect(loadCheckpoint()).toBeNull();
    stored.clear();
    saveRide({ ...record, seconds: 30 });
    expect(importRideBackup(backup([], checkpoint)).recovered).toBe(false);
    expect(listRides()[0]?.seconds).toBe(30);
  });

  it.each([
    "not JSON",
    JSON.stringify({ version: 3, rides: [] }),
    backup([record, { ...record, startedAt: "bad date" }]),
    backup([record], { ...checkpoint, workout: { ...checkpoint.workout, seconds: 1 } }),
    backup([{ ...record, samples: [...record.samples].reverse() }]),
    backup([{ ...record, samples: [{ ...record.samples[0], seconds: 3 }] }]),
    backup([{ ...record, samples: [{ ...record.samples[0], distanceKm: 0.03 }] }]),
    backup([
      {
        ...record,
        samples: [
          { ...record.samples[0], distanceKm: 0.02 },
          { ...record.samples[1], distanceKm: 0.01 },
        ],
      },
    ]),
    backup(Array.from({ length: 101 }, () => record)),
  ])("rejects the entire malformed backup before writing anything", (json) => {
    saveCheckpoint(checkpoint);
    const before = stored.get(KEY);
    setItem.mockClear();
    expect(() => importRideBackup(json)).toThrow();
    expect(setItem).not.toHaveBeenCalled();
    expect(stored.get(KEY)).toBe(before);
    expect(loadCheckpoint()).toEqual(checkpoint);
  });

  it("rejects oversized data before parsing and preserves existing data on quota failure", () => {
    saveCheckpoint(checkpoint);
    const before = stored.get(KEY);
    expect(() => importRideBackup(" ".repeat(BACKUP_BYTE_LIMIT + 1))).toThrow(/20 MB/);
    setItem.mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
    const incoming = { ...record, startedAt: "2026-09-28T12:00:00.000Z" };
    expect(() => importRideBackup(backup([incoming]))).toThrow(/Quota/);
    expect(stored.get(KEY)).toBe(before);
    expect(loadCheckpoint()).toEqual(checkpoint);
    expect(listRides()).toEqual([checkpoint.record]);
  });

  it("imports a legacy-shaped record without requiring new sensor or mode fields", () => {
    const legacy = {
      ...record,
      samples: [{ seconds: 1, watts: 0, cadence: null, speed: null, target: 100 }],
    };
    expect(importRideBackup(backup([legacy])).imported).toBe(1);
    expect(listRides()[0]).toEqual(legacy);
  });
});
