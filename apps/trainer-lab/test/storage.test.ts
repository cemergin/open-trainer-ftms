import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RideRecord } from "../src/ride";
import { createWorkout } from "../src/workout";
import { spiceWorkout } from "../src/workout-spice";
import {
  clearCheckpoint,
  exportAllData,
  listRides,
  loadCheckpoint,
  loadRide,
  rideCsv,
  RIDE_HISTORY_LIMIT,
  saveCheckpoint,
  saveRide,
  type RideCheckpoint,
} from "../src/storage";

const KEY = "open-trainer:rides:v2";
const LEGACY_KEY = "open-trainer:last-ride:v1";
const record: RideRecord = {
  version: 1,
  startedAt: "2026-09-27T12:00:00.000Z",
  name: "Steady ride",
  simulator: false,
  seconds: 1,
  distanceKm: 0.01,
  averagePower: 100,
  workKj: 0.1,
  completed: false,
  samples: [{ seconds: 1, watts: 100, cadence: null, speed: 36, target: 100 }],
};
const checkpoint: RideCheckpoint = {
  version: 1,
  workout: createWorkout("endurance", 30, 100),
  record,
  adjustment: 5,
  savedAt: "2026-09-27T12:00:01.000Z",
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

describe("saved ride history", () => {
  it("round-trips measurements and upserts the same ride instead of duplicating autosaves", () => {
    expect(saveRide(record)).toBe(true);
    expect(loadRide()).toEqual(record);
    const updated = { ...record, seconds: 2, simulator: true };
    expect(saveRide(updated)).toBe(true);
    expect(listRides()).toEqual([updated]);
  });

  it("preserves earlier rides and returns the latest first", () => {
    const older = { ...record, startedAt: "2026-09-26T12:00:00.000Z", simulator: true };
    expect(saveRide(record)).toBe(true);
    expect(saveRide(older)).toBe(true);
    expect(listRides()).toEqual([record, older]);
    expect(loadRide()).toEqual(record);
  });

  it("retains the advertised number of most recent full rides", () => {
    for (let day = 1; day <= RIDE_HISTORY_LIMIT + 1; day++) {
      expect(
        saveRide({ ...record, startedAt: new Date(Date.UTC(2026, 8, day)).toISOString() }),
      ).toBe(true);
    }
    const rides = listRides();
    expect(rides).toHaveLength(RIDE_HISTORY_LIMIT);
    expect(rides.at(-1)?.startedAt).toBe("2026-09-02T00:00:00.000Z");
    expect(rides[0]?.samples).toEqual(record.samples);
  });

  it("migrates the legacy latest ride without changing its data", () => {
    stored.set(LEGACY_KEY, JSON.stringify(record));
    expect(loadRide()).toEqual(record);
    expect(JSON.parse(stored.get(KEY) ?? "null")).toEqual({
      version: 2,
      rides: [record],
      checkpoint: null,
    });
    expect(stored.has(LEGACY_KEY)).toBe(true);
    expect(saveRide({ ...record, startedAt: "2026-09-28T12:00:00.000Z" })).toBe(true);
    expect(listRides()).toHaveLength(2);
  });

  it("still reads legacy data if migration is blocked by storage quota", () => {
    stored.set(LEGACY_KEY, JSON.stringify(record));
    setItem.mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
    expect(loadRide()).toEqual(record);
    expect(saveRide({ ...record, seconds: 2 })).toBe(false);
    expect(loadRide()).toEqual(record);
  });

  it("returns no ride for absent or invalid JSON", () => {
    expect(loadRide()).toBeNull();
    stored.set(KEY, "not JSON");
    expect(loadRide()).toBeNull();
  });

  it.each([
    { version: 2 },
    { startedAt: "not a date" },
    { simulator: "false" },
    { completed: null },
    { seconds: -1 },
    { distanceKm: "0" },
    { workKj: null },
    { averagePower: "100" },
    { samples: [null] },
    { samples: [{ ...record.samples[0], seconds: "1" }] },
    { samples: [{ ...record.samples[0], watts: "=IMPORTDATA(1)" }] },
    { samples: [{ ...record.samples[0], cadence: undefined }] },
    { measuredSeconds: -1 },
    { measuredSeconds: 2 },
  ])("ignores malformed records while keeping valid history: %j", (invalid) => {
    stored.set(
      KEY,
      JSON.stringify({ version: 2, rides: [{ ...record, ...invalid }, record], checkpoint: null }),
    );
    expect(listRides()).toEqual([record]);
  });

  it("handles disabled storage without throwing or reporting save success", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("Storage blocked");
      },
      setItem: () => {
        throw new Error("Quota exceeded");
      },
    });
    expect(saveRide(record)).toBe(false);
    expect(saveCheckpoint(checkpoint)).toBe(false);
    expect(clearCheckpoint()).toBe(false);
    expect(loadRide()).toBeNull();
    expect(loadCheckpoint()).toBeNull();
  });

  it("preserves stored history when a later save exceeds quota", () => {
    expect(saveRide(record)).toBe(true);
    const before = stored.get(KEY);
    setItem.mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
    expect(saveRide({ ...record, seconds: 2 })).toBe(false);
    expect(stored.get(KEY)).toBe(before);
    expect(loadRide()).toEqual(record);
  });

  it("does not overwrite an unknown future store version", () => {
    const future = JSON.stringify({ version: 3, rides: [record] });
    stored.set(KEY, future);
    expect(saveRide(record)).toBe(false);
    expect(clearCheckpoint()).toBe(false);
    expect(stored.get(KEY)).toBe(future);
  });
});

describe("ride recovery checkpoints", () => {
  it("keeps the exact Spice mix and ramps in recovery and backups", () => {
    const workout = spiceWorkout(createWorkout("hills", 20, 120), "hills", 42);
    const spiced = { ...checkpoint, workout, record: { ...record, name: workout.name } };
    expect(saveCheckpoint(spiced)).toBe(true);
    expect(loadCheckpoint()).toEqual(spiced);
    expect(JSON.parse(exportAllData()).checkpoint.workout).toEqual(workout);
  });

  it.each([
    null,
    { mode: "free", variation: 1 },
    { mode: "unknown", variation: 1 },
    { mode: "hills", variation: 0 },
    { mode: "hills", variation: 10000 },
    { mode: "hills", variation: 1.5 },
    { mode: "hills", variation: "2" },
  ])("rejects invalid Spice metadata without losing ride history: %j", (spice) => {
    stored.set(
      KEY,
      JSON.stringify({
        version: 2,
        rides: [record],
        checkpoint: {
          ...checkpoint,
          workout: { ...checkpoint.workout, spice },
        },
      }),
    );
    expect(loadCheckpoint()).toBeNull();
    expect(loadRide()).toEqual(record);
  });

  it("atomically checkpoints progress and history without duplicate rides", () => {
    expect(saveCheckpoint(checkpoint)).toBe(true);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(loadCheckpoint()).toEqual(checkpoint);
    expect(listRides()).toEqual([record]);
    const newer = { ...checkpoint, record: { ...record, seconds: 2 }, adjustment: -5 };
    expect(saveCheckpoint(newer)).toBe(true);
    expect(loadCheckpoint()).toEqual(newer);
    expect(listRides()).toEqual([newer.record]);
  });

  it("restores an open-ended workout's infinite duration from valid JSON", () => {
    const workout = createWorkout("free", 30, 100);
    const free = {
      ...checkpoint,
      workout,
      record: { ...record, name: workout.name, simulator: true },
    };
    expect(saveCheckpoint(free)).toBe(true);
    expect(JSON.parse(stored.get(KEY) ?? "null").checkpoint.workout.steps[0].seconds).toBeNull();
    expect(loadCheckpoint()).toEqual(free);
    expect(loadCheckpoint()?.workout.steps[0]?.seconds).toBe(Infinity);
  });

  it("preserves exact measured duration for average-power recovery", () => {
    const measured = { ...checkpoint, record: { ...record, measuredSeconds: 0.9 } };
    expect(saveCheckpoint(measured)).toBe(true);
    expect(loadCheckpoint()?.record).toEqual(measured.record);
  });

  it.each([
    null,
    { ...checkpoint, version: 2 },
    { ...checkpoint, savedAt: "bad date" },
    { ...checkpoint, adjustment: "5" },
    { ...checkpoint, record: { ...record, completed: true } },
    { ...checkpoint, record: { ...record, name: "Different workout" } },
    { ...checkpoint, record: { ...record, seconds: 1800 } },
    { ...checkpoint, workout: { ...checkpoint.workout, steps: [] } },
    {
      ...checkpoint,
      workout: {
        ...checkpoint.workout,
        steps: [{ name: "Invalid", seconds: null, watts: 100, effort: "steady" }],
      },
    },
    {
      ...checkpoint,
      workout: {
        ...checkpoint.workout,
        steps: [{ name: "Invalid", seconds: 1800, watts: 100, effort: { toString: null } }],
      },
    },
    { ...checkpoint, workout: { ...checkpoint.workout, seconds: 20 } },
  ])("ignores malformed or completed recovery without losing history: %j", (invalid) => {
    stored.set(KEY, JSON.stringify({ version: 2, rides: [record], checkpoint: invalid }));
    expect(loadCheckpoint()).toBeNull();
    expect(loadRide()).toEqual(record);
  });

  it("rejects invalid checkpoints without altering saved progress", () => {
    expect(saveCheckpoint(checkpoint)).toBe(true);
    expect(saveCheckpoint({ ...checkpoint, adjustment: Infinity })).toBe(false);
    expect(saveCheckpoint({ ...checkpoint, workout: null } as unknown as RideCheckpoint)).toBe(
      false,
    );
    expect(loadCheckpoint()).toEqual(checkpoint);
  });

  it("keeps the previous checkpoint when a save exceeds quota", () => {
    expect(saveCheckpoint(checkpoint)).toBe(true);
    const before = stored.get(KEY);
    setItem.mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
    expect(saveCheckpoint({ ...checkpoint, record: { ...record, seconds: 2 } })).toBe(false);
    expect(stored.get(KEY)).toBe(before);
    expect(loadCheckpoint()).toEqual(checkpoint);
  });

  it("clears recovery without deleting history", () => {
    expect(saveCheckpoint(checkpoint)).toBe(true);
    expect(clearCheckpoint()).toBe(true);
    expect(loadCheckpoint()).toBeNull();
    expect(listRides()).toEqual([record]);
  });
});

describe("ride data exports", () => {
  it("exports missing measurements as blanks and identifies real versus simulated data", () => {
    const rows = rideCsv(record).split("\n");
    expect(rows[0]).toBe(
      "elapsed_seconds,power_watts,cadence_rpm,speed_kph,target_watts,data_source,ride_started_at",
    );
    expect(rows[1]).toBe("1.00,100,,36,100,trainer,2026-09-27T12:00:00.000Z");
    expect(rideCsv({ ...record, simulator: true })).toContain(",simulator,");
  });

  it("exports retained rides, recovery, version, and retention metadata as JSON", () => {
    expect(saveCheckpoint(checkpoint)).toBe(true);
    const exported = JSON.parse(exportAllData());
    expect(exported).toMatchObject({
      version: 2,
      rides: [record],
      checkpoint,
      historyLimit: RIDE_HISTORY_LIMIT,
    });
    expect(Number.isFinite(Date.parse(exported.exportedAt))).toBe(true);
  });

  it("reports unreadable storage instead of exporting an apparently empty archive", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("Storage blocked");
      },
    });
    expect(() => exportAllData()).toThrow("Storage blocked");
  });
});
