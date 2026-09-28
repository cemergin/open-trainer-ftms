/** Application boundary for trainer adapters, local persistence, and browser capabilities. */
import { createMockTrainer } from "@open-trainer/ftms/testing";
import { createWebBluetoothTrainer } from "@open-trainer/ftms/web-bluetooth";
import type { RideRecord } from "../ride";
import type { Trainer } from "@open-trainer/ftms";

export { FtmsCommandSupersededError } from "@open-trainer/ftms";
export type {
  Trainer,
  TrainerCapabilities,
  TrainerTelemetry,
  Unsubscribe,
  ValueRange,
} from "@open-trainer/ftms";
export {
  loadRide,
  saveRide,
  rideCsv,
  listRides,
  loadCheckpoint,
  saveCheckpoint,
  clearCheckpoint,
  exportAllData,
  RIDE_HISTORY_LIMIT,
  importRideBackup,
  deleteRide,
  rideStorageInfo,
  BACKUP_BYTE_LIMIT,
  type RideCheckpoint,
} from "../storage";

export function createTrainerConnection(
  simulator: boolean,
  resistanceControlFormat: "sint16" | "uint8" = "sint16",
): Trainer {
  return simulator
    ? createMockTrainer({ resistanceControlFormat }, { resistanceControlFormat })
    : createWebBluetoothTrainer({}, { resistanceControlFormat });
}

export function bluetoothSupported(): boolean {
  return Boolean(navigator.bluetooth) && window.isSecureContext;
}

export type WakeStatus = "inactive" | "requesting" | "active" | "unavailable";
let wakeStatus: WakeStatus = "inactive";
export function screenAwakeStatus(): WakeStatus {
  return wakeStatus;
}

let wakeLock: WakeLockSentinel | undefined;
let wakeRequestPending = false;
let shouldStayAwake = false;
let wasVisible = true;
let nextWakeAttempt = 0;
const WAKE_RETRY_DELAY_MS = 30_000;

/** Browsers may refuse wake locks, and hidden documents cannot keep the screen awake. */
export async function keepScreenAwake(active: boolean): Promise<void> {
  const resumed = active && !shouldStayAwake;
  const visible = document.visibilityState === "visible";
  const becameVisible = visible && !wasVisible;
  wasVisible = visible;
  shouldStayAwake = active;
  if (resumed || becameVisible || !active) nextWakeAttempt = 0;
  if (!active) {
    wakeStatus = "inactive";
    if (wakeLock) {
      const lock = wakeLock;
      wakeLock = undefined;
      await lock.release().catch(() => undefined);
    }
    return;
  }
  const browser: Partial<Navigator> = navigator;
  if (!browser.wakeLock || !visible) {
    wakeStatus = "unavailable";
    return;
  }
  if (wakeLock) {
    wakeStatus = "active";
    return;
  }
  if (wakeRequestPending) {
    wakeStatus = "requesting";
    return;
  }
  if (Date.now() < nextWakeAttempt) return;
  wakeRequestPending = true;
  wakeStatus = "requesting";
  try {
    const lock = await browser.wakeLock.request("screen");
    if (!shouldStayAwake || document.visibilityState !== "visible" || lock.released) {
      wakeStatus = shouldStayAwake ? "unavailable" : "inactive";
      nextWakeAttempt = Date.now() + WAKE_RETRY_DELAY_MS;
      await lock.release();
      return;
    }
    wakeLock = lock;
    wakeStatus = "active";
    lock.addEventListener("release", () => {
      if (wakeLock === lock) {
        wakeLock = undefined;
        wakeStatus = shouldStayAwake ? "unavailable" : "inactive";
        nextWakeAttempt = Date.now() + WAKE_RETRY_DELAY_MS;
      }
    });
  } catch {
    wakeStatus = shouldStayAwake ? "unavailable" : "inactive";
    nextWakeAttempt = Date.now() + WAKE_RETRY_DELAY_MS;
    /* Wake lock is optional; local riding and controls remain available. */
  } finally {
    wakeRequestPending = false;
  }
}

/** Download stays at the browser-service boundary so views do not manage object URLs. */
export function downloadText(content: string, filename: string, mime: string): void {
  downloadBlob(new Blob([content], { type: mime }), filename);
}

export function downloadBytes(
  content: Uint8Array<ArrayBuffer>,
  filename: string,
  mime: string,
): void {
  downloadBlob(new Blob([content], { type: mime }), filename);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(content: string): Promise<void> {
  const browser: Partial<Navigator> = navigator;
  if (!browser.clipboard) throw new Error("Clipboard is unavailable. Use Download instead.");
  await browser.clipboard.writeText(content);
}

export { loadQualificationDraft, saveQualificationDraft } from "./qualification-storage.js";

export function qualificationClient(): {
  operatingSystem: string;
  browser: string;
  browserVersion: string;
  secureContext: boolean;
} {
  const userAgent = navigator.userAgent;
  const candidates: [string, RegExp][] = [
    ["Edge", /Edg\/([\d.]+)/],
    ["Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari/],
  ];
  const detected = candidates
    .map(([browser, pattern]) => ({ browser, version: pattern.exec(userAgent)?.[1] }))
    .find((result) => result.version);
  const systems: [string, RegExp][] = [
    ["Android", /Android ([\d.]+)/],
    ["iOS", /(?:iPhone OS|CPU OS) ([\d_]+)/],
    ["macOS", /Mac OS X ([\d_]+)/],
    ["Windows NT", /Windows NT ([\d.]+)/],
  ];
  let operatingSystem = userAgent.includes("Linux") ? "Linux" : "Unknown";
  for (const [name, pattern] of systems) {
    const match = pattern.exec(userAgent);
    if (match?.[1]) {
      operatingSystem = `${name} ${match[1].replaceAll("_", ".")}`;
      break;
    }
  }
  return {
    operatingSystem,
    browser: detected?.browser ?? "Unknown",
    browserVersion: detected?.version ?? "Unknown",
    secureContext: window.isSecureContext,
  };
}

export {
  SensorManager,
  type SensorMetric,
  type TelemetrySource,
  type SensorSources,
  type SensorSlot,
  type SensorManagerState,
  type ResolvedTelemetry,
  type SensorKind,
  type SensorState,
  type SensorTelemetry,
} from "./sensors";
export {
  loadWorkoutProfiles,
  saveWorkoutProfile,
  removeWorkoutProfile,
  parseWorkoutJson,
  exportWorkoutJson,
  WORKOUT_PROFILE_LIMIT,
  WORKOUT_JSON_LIMIT,
} from "./workouts";
export async function rideFit(record: RideRecord): Promise<Uint8Array<ArrayBuffer>> {
  const fit = await import("./fit");
  return fit.rideFit(record);
}
export { RideCoach } from "./coaching";

export type { CommandEvent, MachineStatus, SpinDownResponse } from "@open-trainer/ftms";
export {
  createLabConnection,
  parseLabTrace,
  readLabTraceFile,
  LabReplay,
  LAB_TRACE_BYTE_LIMIT,
  type LabFault,
  type LabConnection,
} from "./lab-trace";

export type { SensorSourceSnapshot, SensorMetricSource } from "./sensors";
