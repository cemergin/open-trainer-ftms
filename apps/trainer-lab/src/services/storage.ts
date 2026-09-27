import type { RideRecord, RideSample } from "../ride";
import { WORKOUT_OPTIONS, type SpiceLevel, type Workout, type WorkoutStep } from "../workout";
import { validWorkoutIntensity } from "../workout-intensity";
import { WORKOUT_LIMITS } from "../workout-profile";

const KEY = "open-trainer:rides:v2";
export const BACKUP_BYTE_LIMIT = 20_000_000;
const SAMPLE_LIMIT = 86_400;
const LEGACY_KEY = "open-trainer:last-ride:v1";
export const RIDE_HISTORY_LIMIT = 100;

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
  return updateStore((store) => {
    store.rides = upsert(store.rides, record);
  });
}

export function listRides(): RideRecord[] {
  try {
    return readStore().rides;
  } catch {
    return [];
  }
}

export function loadRide(): RideRecord | null {
  return listRides()[0] ?? null;
}

export function saveCheckpoint(checkpoint: RideCheckpoint): boolean {
  return updateStore((store) => {
    const valid = decodeCheckpoint(encodeCheckpoint(checkpoint));
    if (!valid) throw new Error("Invalid ride checkpoint.");
    store.rides = upsert(store.rides, valid.record);
    store.checkpoint = valid;
  });
}

export function loadCheckpoint(): RideCheckpoint | null {
  try {
    return readStore().checkpoint;
  } catch {
    return null;
  }
}

export function clearCheckpoint(): boolean {
  return updateStore((store) => {
    store.checkpoint = null;
  });
}

export function exportAllData(): string {
  const store = readStore();
  return JSON.stringify(
    {
      ...store,
      checkpoint: encodeCheckpoint(store.checkpoint),
      exportedAt: new Date().toISOString(),
      historyLimit: RIDE_HISTORY_LIMIT,
    },
    null,
    2,
  );
}

export function rideCsv(record: RideRecord): string {
  const startedAt = new Date(record.startedAt).toISOString();
  const detailed =
    (record.sourceChanges?.length ?? 0) > 0 ||
    record.controlMode !== undefined ||
    record.samples.some(
      (sample) =>
        sample.heartRate !== undefined ||
        sample.distanceKm !== undefined ||
        sample.grade !== undefined ||
        sample.resistance !== undefined,
    );
  let sourceIndex = -1;
  return [
    "elapsed_seconds,power_watts,cadence_rpm,speed_kph,target_watts,data_source,ride_started_at" +
      (detailed
        ? ",heart_rate_bpm,distance_km,grade_percent,resistance_level,power_source,cadence_source,heart_rate_source,control_mode"
        : ""),
    ...record.samples.map((sample) => {
      const changes = record.sourceChanges ?? [];
      while (
        sourceIndex + 1 < changes.length &&
        (changes[sourceIndex + 1]?.seconds ?? Infinity) <= sample.seconds
      )
        sourceIndex++;
      const sources = changes[sourceIndex]?.sources;
      const row: (string | number)[] = [
        sample.seconds.toFixed(2),
        sample.watts ?? "",
        sample.cadence ?? "",
        sample.speed ?? "",
        sample.target,
        record.simulator ? "simulator" : "trainer",
        startedAt,
      ];
      if (detailed)
        row.push(
          sample.heartRate ?? "",
          sample.distanceKm ?? "",
          sample.grade ?? "",
          sample.resistance ?? "",
          sources?.power.source ?? "",
          sources?.cadence.source ?? "",
          sources?.heartRate.source ?? "",
          record.controlMode ?? "erg",
        );
      return row.join(",");
    }),
  ].join("\n");
}

function updateStore(update: (store: RideStore) => void): boolean {
  try {
    const store = readStore();
    update(store);
    writeStore(store);
    return true;
  } catch {
    return false;
  }
}

function readStore(): RideStore {
  const value = parse(localStorage.getItem(KEY));
  if (object(value) && value.version !== 2) throw new Error("Unsupported local ride data version.");
  if (object(value) && Array.isArray(value.rides)) {
    return {
      version: 2,
      rides: newestRides(value.rides.filter(validRecord)),
      checkpoint: decodeCheckpoint(value.checkpoint),
    };
  }
  const legacy = parse(localStorage.getItem(LEGACY_KEY));
  const store: RideStore = {
    version: 2,
    rides: validRecord(legacy) ? [legacy] : [],
    checkpoint: null,
  };
  if (store.rides.length) {
    try {
      writeStore(store);
    } catch {
      /* The legacy copy remains readable if migration cannot be persisted. */
    }
  }
  return store;
}

function writeStore(store: RideStore): void {
  localStorage.setItem(
    KEY,
    JSON.stringify({ ...store, checkpoint: encodeCheckpoint(store.checkpoint) }),
  );
}

function upsert(rides: RideRecord[], record: RideRecord): RideRecord[] {
  return newestRides([record, ...rides.filter((ride) => ride.startedAt !== record.startedAt)]);
}

function newestRides(rides: RideRecord[]): RideRecord[] {
  const unique = new Map<string, RideRecord>();
  for (const ride of rides) if (!unique.has(ride.startedAt)) unique.set(ride.startedAt, ride);
  return [...unique.values()]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, RIDE_HISTORY_LIMIT);
}

function encodeCheckpoint(checkpoint: RideCheckpoint | null): Record<string, unknown> | null {
  if (!checkpoint) return null;
  return {
    ...checkpoint,
    workout: {
      ...checkpoint.workout,
      steps: checkpoint.workout.steps.map((step) => ({
        ...step,
        seconds: step.seconds === Infinity ? null : step.seconds,
      })),
    },
  };
}

function decodeCheckpoint(value: unknown): RideCheckpoint | null {
  if (
    !object(value) ||
    value.version !== 1 ||
    !validRecord(value.record) ||
    value.record.completed ||
    !finite(value.adjustment) ||
    !timestamp(value.savedAt)
  )
    return null;
  const workout = decodeWorkout(value.workout);
  if (
    value.record.name !== workout?.name ||
    (workout.seconds !== null &&
      (value.record.workoutElapsed ?? value.record.seconds) >= workout.seconds)
  )
    return null;
  return {
    version: 1,
    record: value.record,
    workout,
    adjustment: value.adjustment,
    savedAt: value.savedAt,
  };
}

function decodeWorkout(value: unknown): Workout | null {
  if (
    !object(value) ||
    typeof value.name !== "string" ||
    !Array.isArray(value.steps) ||
    !value.steps.length ||
    value.steps.length > WORKOUT_LIMITS.steps
  )
    return null;
  if (
    value.seconds !== null &&
    (!nonnegative(value.seconds) || value.seconds === 0 || value.seconds > WORKOUT_LIMITS.seconds)
  )
    return null;
  const steps: WorkoutStep[] = [];
  for (const step of value.steps) {
    if (
      !object(step) ||
      typeof step.name !== "string" ||
      !nonnegative(step.watts) ||
      (step.endWatts !== undefined && !nonnegative(step.endWatts)) ||
      (step.cadenceRpm !== undefined && (!nonnegative(step.cadenceRpm) || step.cadenceRpm > 250)) ||
      typeof step.effort !== "string" ||
      !["easy", "steady", "hard"].includes(step.effort)
    )
      return null;
    const seconds = step.seconds === null && value.seconds === null ? Infinity : step.seconds;
    if (seconds !== Infinity && (!nonnegative(seconds) || seconds === 0)) return null;
    steps.push({
      name: step.name,
      seconds,
      watts: step.watts,
      effort: step.effort as WorkoutStep["effort"],
      ...(step.endWatts !== undefined ? { endWatts: step.endWatts } : {}),
      ...(step.cadenceRpm !== undefined ? { cadenceRpm: step.cadenceRpm } : {}),
    });
  }
  const expandedSeconds = steps.reduce((total, step) => total + step.seconds, 0);
  if (value.seconds === null) {
    if (steps.length !== 1 || steps[0]?.seconds !== Infinity) return null;
  } else if (
    expandedSeconds > WORKOUT_LIMITS.seconds ||
    Math.abs(expandedSeconds - value.seconds) > 0.001
  )
    return null;
  const spice = value.spice === undefined ? undefined : decodeSpice(value.spice);
  if (
    spice === null ||
    (spice && value.seconds === null) ||
    (value.referenceWatts !== undefined &&
      (!finite(value.referenceWatts) || value.referenceWatts < 25 || value.referenceWatts > 600))
  )
    return null;
  return {
    name: value.name,
    seconds: value.seconds,
    steps,
    ...(spice ? { spice } : {}),
    ...(value.referenceWatts === undefined ? {} : { referenceWatts: value.referenceWatts }),
  };
}

function decodeSpice(value: unknown): Workout["spice"] | null {
  if (!object(value)) return null;
  const mode = WORKOUT_OPTIONS.find((option) => option.id === value.mode)?.id;
  if (
    !mode ||
    mode === "free" ||
    !finite(value.variation) ||
    !Number.isInteger(value.variation) ||
    value.variation < 1 ||
    value.variation > 9999 ||
    (value.level !== undefined &&
      (typeof value.level !== "string" || !["mild", "spicy", "hot"].includes(value.level)))
  )
    return null;
  return {
    mode,
    variation: value.variation,
    ...(value.level === undefined ? {} : { level: value.level as SpiceLevel }),
  };
}

function validRecord(value: unknown): value is RideRecord {
  if (
    !object(value) ||
    value.version !== 1 ||
    typeof value.name !== "string" ||
    value.name.length > 200 ||
    !timestamp(value.startedAt) ||
    typeof value.simulator !== "boolean" ||
    typeof value.completed !== "boolean" ||
    !nonnegative(value.seconds) ||
    !nonnegative(value.distanceKm) ||
    !nonnegative(value.workKj) ||
    (value.averagePower !== null && !nonnegative(value.averagePower)) ||
    (value.controlMode !== undefined &&
      (typeof value.controlMode !== "string" ||
        !["erg", "resistance", "terrain"].includes(value.controlMode))) ||
    (value.routeId !== undefined &&
      (typeof value.routeId !== "string" || value.routeId.length > 100)) ||
    (value.workoutElapsed !== undefined && !nonnegative(value.workoutElapsed)) ||
    (value.controlTarget !== undefined && !finite(value.controlTarget)) ||
    !validWorkoutIntensity(value.intensity, value.controlMode) ||
    !Array.isArray(value.samples) ||
    value.samples.length > SAMPLE_LIMIT ||
    !value.samples.every(validSample) ||
    !validSources(value.sourceChanges, value.seconds)
  )
    return false;
  let previous = -1;
  let distance = 0;
  for (const sample of value.samples) {
    if (
      sample.seconds < previous ||
      sample.seconds > value.seconds ||
      (sample.distanceKm !== undefined &&
        (sample.distanceKm < distance || sample.distanceKm > value.distanceKm + 0.000001))
    )
      return false;
    previous = sample.seconds;
    distance = sample.distanceKm ?? distance;
  }
  return (
    value.measuredSeconds === undefined ||
    (nonnegative(value.measuredSeconds) && value.measuredSeconds <= value.seconds)
  );
}

function validSample(value: unknown): value is RideSample {
  return (
    object(value) &&
    nonnegative(value.seconds) &&
    nonnegative(value.target) &&
    (value.heartRate === undefined || value.heartRate === null || nonnegative(value.heartRate)) &&
    (value.distanceKm === undefined || nonnegative(value.distanceKm)) &&
    (value.grade === undefined || finite(value.grade)) &&
    (value.resistance === undefined || nonnegative(value.resistance)) &&
    [value.watts, value.cadence, value.speed].every((metric) => metric === null || finite(metric))
  );
}

function parse(value: string | null): unknown {
  try {
    return JSON.parse(value ?? "null");
  } catch {
    return null;
  }
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

/** Validate the whole backup before one atomic localStorage write. Existing recovery always wins. */
export function importRideBackup(json: string): {
  imported: number;
  total: number;
  recovered: boolean;
} {
  if (json.length > BACKUP_BYTE_LIMIT) throw new Error("Ride backups must be smaller than 20 MB.");
  const value: unknown = JSON.parse(json);
  if (
    !object(value) ||
    value.version !== 2 ||
    !Array.isArray(value.rides) ||
    value.rides.length > RIDE_HISTORY_LIMIT ||
    !value.rides.every(validRecord)
  )
    throw new Error("Choose a valid Open Trainer ride backup (version 2, up to 100 rides).");
  const checkpoint =
    value.checkpoint === null || value.checkpoint === undefined
      ? null
      : decodeCheckpoint(value.checkpoint);
  if (value.checkpoint !== null && value.checkpoint !== undefined && !checkpoint)
    throw new Error("The backup contains an invalid recovery checkpoint.");
  const store = readStore();
  const incoming: RideRecord[] = value.rides;
  const merged = new Map(store.rides.map((record) => [record.startedAt, record]));
  let imported = 0;
  for (const record of incoming) {
    const existing = merged.get(record.startedAt);
    if (store.checkpoint?.record.startedAt === record.startedAt) continue;
    if (
      !existing ||
      record.seconds > existing.seconds ||
      (record.seconds === existing.seconds && record.completed && !existing.completed)
    ) {
      merged.set(record.startedAt, record);
      imported++;
    }
  }
  const existingRecoveryRecord = checkpoint ? merged.get(checkpoint.record.startedAt) : undefined;
  const recovered =
    !store.checkpoint &&
    Boolean(checkpoint) &&
    !existingRecoveryRecord?.completed &&
    (existingRecoveryRecord?.seconds ?? 0) <= (checkpoint?.record.seconds ?? 0);
  if (recovered && checkpoint) {
    store.checkpoint = checkpoint;
    merged.set(checkpoint.record.startedAt, checkpoint.record);
  }
  store.rides = newestRides([...merged.values()]);
  writeStore(store);
  return { imported, total: store.rides.length, recovered };
}

export function deleteRide(startedAt: string): void {
  const store = readStore();
  if (store.checkpoint?.record.startedAt === startedAt)
    throw new Error("Recover or archive the unfinished ride before deleting it.");
  store.rides = store.rides.filter((record) => record.startedAt !== startedAt);
  writeStore(store);
}

export function rideStorageInfo(): {
  bytes: number;
  rides: number;
  samples: number;
  limit: number;
} {
  const store = readStore();
  return {
    bytes: new Blob([localStorage.getItem(KEY) ?? ""]).size,
    rides: store.rides.length,
    samples: store.rides.reduce((total, record) => total + record.samples.length, 0),
    limit: RIDE_HISTORY_LIMIT,
  };
}

function validSources(value: unknown, seconds: number): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > SAMPLE_LIMIT) return false;
  let previous = -1;
  return value.every((change) => {
    if (
      !object(change) ||
      !nonnegative(change.seconds) ||
      change.seconds < previous ||
      change.seconds > seconds ||
      !object(change.sources)
    )
      return false;
    previous = change.seconds;
    const sources = change.sources;
    return [sources.power, sources.cadence, sources.heartRate].every(
      (source) =>
        object(source) &&
        ["trainer", "external", "none"].includes(String(source.source)) &&
        (source.sensorName === null ||
          (typeof source.sensorName === "string" && source.sensorName.length <= 200)) &&
        (source.simulator === null || typeof source.simulator === "boolean"),
    );
  });
}
