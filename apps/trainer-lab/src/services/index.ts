/** Application boundary for trainer adapters, local persistence, and browser capabilities. */
import { createMockTrainer } from "@open-trainer/ftms/testing";
import { createWebBluetoothTrainer } from "@open-trainer/ftms/web-bluetooth";
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

let wakeLock: WakeLockSentinel | undefined;
let wakeRequestPending = false;
let shouldStayAwake = false;

export async function keepScreenAwake(active: boolean): Promise<void> {
  shouldStayAwake = active;
  if (!active) {
    if (wakeLock) {
      const lock = wakeLock;
      wakeLock = undefined;
      await lock.release().catch(() => undefined);
    }
    return;
  }
  const browser: Partial<Navigator> = navigator;
  if (!browser.wakeLock || wakeLock || wakeRequestPending || document.visibilityState !== "visible")
    return;
  wakeRequestPending = true;
  try {
    const lock = await browser.wakeLock.request("screen");
    if (!shouldStayAwake) {
      await lock.release();
      return;
    }
    wakeLock = lock;
    lock.addEventListener("release", () => {
      if (wakeLock === lock) wakeLock = undefined;
    });
  } catch {
    /* Wake lock is optional; local riding and controls remain available. */
  } finally {
    wakeRequestPending = false;
  }
}

/** Download stays at the browser-service boundary so views do not manage object URLs. */
export function downloadText(content: string, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
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
