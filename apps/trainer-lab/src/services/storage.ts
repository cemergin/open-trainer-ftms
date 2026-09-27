import type { RideRecord, RideSample } from "../ride";
import type { Workout, WorkoutStep } from "../workout";

const KEY = "open-trainer:rides:v2";
const LEGACY_KEY = "open-trainer:last-ride:v1";
export const RIDE_HISTORY_LIMIT = 30;

export interface RideCheckpoint {
  version: 1;
  workout: Workout;
  record: RideRecord;
  adjustment: number;
  savedAt: string;
}

interface RideStore {
  version: 2;
  rides: RideRecord[];
  checkpoint: RideCheckpoint | null;
}

export function saveRide(record: RideRecord): boolean {
  if (!validRecord(record)) return false;
  return updateStore(store => { store.rides = upsert(store.rides, record); });
}

export function listRides(): RideRecord[] {
  try { return readStore().rides; }
  catch { return []; }
}

export function loadRide(): RideRecord | null {
  return listRides()[0] ?? null;
}

export function saveCheckpoint(checkpoint: RideCheckpoint): boolean {
  return updateStore(store => {
    const valid = decodeCheckpoint(encodeCheckpoint(checkpoint));
    if (!valid) throw new Error("Invalid ride checkpoint.");
    store.rides = upsert(store.rides, valid.record);
    store.checkpoint = valid;
  });
}

export function loadCheckpoint(): RideCheckpoint | null {
  try { return readStore().checkpoint; }
  catch { return null; }
}

export function clearCheckpoint(): boolean {
  return updateStore(store => { store.checkpoint = null; });
}

export function exportAllData(): string {
  const store = readStore();
  return JSON.stringify({
    ...store, checkpoint: encodeCheckpoint(store.checkpoint),
    exportedAt: new Date().toISOString(), historyLimit: RIDE_HISTORY_LIMIT,
  }, null, 2);
}

export function rideCsv(record: RideRecord): string {
  const startedAt = new Date(record.startedAt).toISOString();
  return ["elapsed_seconds,power_watts,cadence_rpm,speed_kph,target_watts,data_source,ride_started_at", ...record.samples.map(sample =>
    [sample.seconds.toFixed(2), sample.watts ?? "", sample.cadence ?? "", sample.speed ?? "", sample.target,
      record.simulator ? "simulator" : "trainer", startedAt].join(","),
  )].join("\n");
}

function updateStore(update: (store: RideStore) => void): boolean {
  try {
    const store = readStore();
    update(store);
    writeStore(store);
    return true;
  } catch { return false; }
}

function readStore(): RideStore {
  const value = parse(localStorage.getItem(KEY));
  if (object(value) && value.version !== 2) throw new Error("Unsupported local ride data version.");
  if (object(value) && Array.isArray(value.rides)) {
    return { version: 2, rides: newestRides(value.rides.filter(validRecord)), checkpoint: decodeCheckpoint(value.checkpoint) };
  }
  const legacy = parse(localStorage.getItem(LEGACY_KEY));
  const store: RideStore = { version: 2, rides: validRecord(legacy) ? [legacy] : [], checkpoint: null };
  if (store.rides.length) {
    try { writeStore(store); }
    catch { /* The legacy copy remains readable if migration cannot be persisted. */ }
  }
  return store;
}

function writeStore(store: RideStore): void {
  localStorage.setItem(KEY, JSON.stringify({ ...store, checkpoint: encodeCheckpoint(store.checkpoint) }));
}

function upsert(rides: RideRecord[], record: RideRecord): RideRecord[] {
  return newestRides([record, ...rides.filter(ride => ride.startedAt !== record.startedAt)]);
}

function newestRides(rides: RideRecord[]): RideRecord[] {
  const unique = new Map<string, RideRecord>();
  for (const ride of rides) if (!unique.has(ride.startedAt)) unique.set(ride.startedAt, ride);
  return [...unique.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, RIDE_HISTORY_LIMIT);
}

function encodeCheckpoint(checkpoint: RideCheckpoint | null) {
  if (!checkpoint) return null;
  return {
    ...checkpoint,
    workout: { ...checkpoint.workout, steps: checkpoint.workout.steps.map(step => ({
      ...step, seconds: step.seconds === Infinity ? null : step.seconds,
    })) },
  };
}

function decodeCheckpoint(value: unknown): RideCheckpoint | null {
  if (!object(value) || value.version !== 1 || !validRecord(value.record) || value.record.completed
    || !finite(value.adjustment) || !timestamp(value.savedAt)) return null;
  const workout = decodeWorkout(value.workout);
  if (!workout || value.record.name !== workout.name || (workout.seconds !== null && value.record.seconds >= workout.seconds)) return null;
  return { version: 1, record: value.record, workout, adjustment: value.adjustment, savedAt: value.savedAt };
}

function decodeWorkout(value: unknown): Workout | null {
  if (!object(value) || typeof value.name !== "string" || !Array.isArray(value.steps) || !value.steps.length) return null;
  if (value.seconds !== null && (!nonnegative(value.seconds) || value.seconds === 0)) return null;
  const steps: WorkoutStep[] = [];
  for (const step of value.steps) {
    if (!object(step) || typeof step.name !== "string" || !nonnegative(step.watts)
      || typeof step.effort !== "string" || !["easy", "steady", "hard"].includes(step.effort)) return null;
    const seconds = step.seconds === null && value.seconds === null ? Infinity : step.seconds;
    if (seconds !== Infinity && (!nonnegative(seconds) || seconds === 0)) return null;
    steps.push({ name: step.name, seconds, watts: step.watts, effort: step.effort as WorkoutStep["effort"] });
  }
  if (value.seconds === null) {
    if (steps.length !== 1 || steps[0]!.seconds !== Infinity) return null;
  } else if (Math.abs(steps.reduce((total, step) => total + step.seconds, 0) - value.seconds) > 0.001) return null;
  return { name: value.name, seconds: value.seconds, steps };
}

function validRecord(value: unknown): value is RideRecord {
  if (!object(value) || value.version !== 1 || typeof value.name !== "string" || !timestamp(value.startedAt)
    || typeof value.simulator !== "boolean" || typeof value.completed !== "boolean"
    || !nonnegative(value.seconds) || !nonnegative(value.distanceKm) || !nonnegative(value.workKj)
    || (value.averagePower !== null && !nonnegative(value.averagePower))
    || !Array.isArray(value.samples) || !value.samples.every(validSample)) return false;
  return value.measuredSeconds === undefined || (nonnegative(value.measuredSeconds) && value.measuredSeconds <= value.seconds);
}

function validSample(value: unknown): value is RideSample {
  return object(value) && nonnegative(value.seconds) && nonnegative(value.target)
    && [value.watts, value.cadence, value.speed].every(metric => metric === null || finite(metric));
}

function parse(value: string | null): unknown {
  try { return JSON.parse(value ?? "null"); }
  catch { return null; }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonnegative(value: unknown): value is number {
  return finite(value) && value >= 0;
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
