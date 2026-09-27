import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportWorkoutJson,
  loadWorkoutProfiles,
  parseWorkoutJson,
  removeWorkoutProfile,
  saveWorkoutProfile,
  WORKOUT_JSON_LIMIT,
} from "../src/services/workouts";
import type { WorkoutProfile } from "../src/workout-profile";

const profile: WorkoutProfile = {
  id: "favorite",
  name: "My ride",
  blocks: [
    {
      repeat: 2,
      steps: [
        { name: "Ramp", seconds: 60, watts: 70, endWatts: 140, cadenceRpm: 85, effort: "steady" },
      ],
    },
  ],
};
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("workout storage and exchange", () => {
  it("round trips repeated ramps and cadence through JSON and saved favorites", () => {
    expect(parseWorkoutJson(exportWorkoutJson(profile))).toEqual(profile);
    saveWorkoutProfile(profile);
    expect(loadWorkoutProfiles()).toEqual([profile]);
    saveWorkoutProfile({ ...profile, name: "Updated" });
    expect(loadWorkoutProfiles()).toHaveLength(1);
    expect(loadWorkoutProfiles()[0]?.name).toBe("Updated");
    removeWorkoutProfile(profile.id);
    expect(loadWorkoutProfiles()).toEqual([]);
  });
  it("rejects malformed, unknown-version, and oversized imports", () => {
    expect(() => parseWorkoutJson("{bad json")).toThrow();
    expect(() => parseWorkoutJson(JSON.stringify({ ...profile, version: 2 }))).toThrow(/version 1/);
    expect(() => parseWorkoutJson(" ".repeat(WORKOUT_JSON_LIMIT + 1))).toThrow(/256 KB/);
  });
  it("does not overwrite malformed saved data or silently drop favorites at the limit", () => {
    storage.set("open-trainer:workouts:v1", "{broken");
    expect(() => saveWorkoutProfile(profile)).toThrow();
    expect(storage.get("open-trainer:workouts:v1")).toBe("{broken");
    storage.clear();
    for (let index = 0; index < 30; index++) saveWorkoutProfile({ ...profile, id: String(index) });
    expect(() => saveWorkoutProfile(profile)).toThrow(/30 saved/);
    saveWorkoutProfile({ ...profile, id: "0", name: "Updated" });
    expect(loadWorkoutProfiles()).toHaveLength(30);
  });
  it("reports quota failures without pretending the profile was saved", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("Quota exceeded");
      },
    });
    expect(() => saveWorkoutProfile(profile)).toThrow(/Download its JSON/);
  });
});
