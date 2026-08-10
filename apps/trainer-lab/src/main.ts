import type {
  Trainer,
  TrainerCapabilities,
  TrainerTelemetry,
  Unsubscribe,
} from "@open-trainer/ftms";
import { createMockTrainer } from "@open-trainer/ftms/testing";
import { createWebBluetoothTrainer } from "@open-trainer/ftms/web-bluetooth";
import {
  buildQualificationReport,
  createEmptyQualificationChecks,
  QUALIFICATION_CHECKS,
  qualificationBlockers,
  qualificationReportFilename,
  type QualificationMetadata,
  type QualificationReadinessInput,
  type QualificationSession,
} from "./qualification.js";
import "./style.css";

type LogKind = "info" | "error";
interface LogEntry {
  at: string;
  kind: LogKind;
  message: string;
}

interface ElementConstructor<T extends HTMLElement> {
  new (): T;
  readonly name: string;
}

const byId = <T extends HTMLElement>(id: string, constructor: ElementConstructor<T>): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  if (!(element instanceof constructor)) {
    throw new Error(`#${id} is not a ${constructor.name}.`);
  }
  return element;
};

const ui = {
  status: byId("status", HTMLElement),
  statusDot: byId("status-dot", HTMLElement),
  deviceName: byId("device-name", HTMLElement),
  connectReal: byId("connect-real", HTMLButtonElement),
  connectSimulator: byId("connect-simulator", HTMLButtonElement),
  disconnect: byId("disconnect", HTMLButtonElement),
  resistanceFormat: byId("resistance-format", HTMLSelectElement),
  requestControl: byId("request-control", HTMLButtonElement),
  start: byId("start", HTMLButtonElement),
  pause: byId("pause", HTMLButtonElement),
  reset: byId("reset", HTMLButtonElement),
  stop: byId("stop", HTMLButtonElement),
  powerForm: byId("power-form", HTMLFormElement),
  powerInput: byId("target-power", HTMLInputElement),
  resistanceForm: byId("resistance-form", HTMLFormElement),
  resistanceInput: byId("resistance", HTMLInputElement),
  gradeForm: byId("grade-form", HTMLFormElement),
  gradeInput: byId("grade", HTMLInputElement),
  power: byId("power", HTMLElement),
  cadence: byId("cadence", HTMLElement),
  speed: byId("speed", HTMLElement),
  distance: byId("distance", HTMLElement),
  capabilities: byId("capabilities", HTMLElement),
  connectionState: byId("connection-state", HTMLElement),
  controlState: byId("control-state", HTMLElement),
  activityState: byId("activity-state", HTMLElement),
  packetAge: byId("packet-age", HTMLElement),
  snapshot: byId("snapshot", HTMLElement),
  copySnapshot: byId("copy-snapshot", HTMLButtonElement),
  log: byId("log", HTMLOListElement),
  clearLog: byId("clear-log", HTMLButtonElement),
  downloadLog: byId("download-log", HTMLButtonElement),
  chart: byId("chart", HTMLCanvasElement),
  qualificationProgress: byId("qualification-progress", HTMLOutputElement),
  qualificationSafety: byId("qualification-safety", HTMLInputElement),
  qualificationManufacturer: byId("qualification-manufacturer", HTMLInputElement),
  qualificationModel: byId("qualification-model", HTMLInputElement),
  qualificationFirmware: byId("qualification-firmware", HTMLInputElement),
  qualificationOs: byId("qualification-os", HTMLInputElement),
  qualificationBrowser: byId("qualification-browser", HTMLInputElement),
  qualificationBrowserVersion: byId("qualification-browser-version", HTMLInputElement),
  qualificationPackageVersion: byId("qualification-package-version", HTMLElement),
  qualificationSecureContext: byId("qualification-secure-context", HTMLElement),
  qualificationConnections: byId("qualification-connections", HTMLElement),
  qualificationTelemetry: byId("qualification-telemetry", HTMLElement),
  qualificationResponses: byId("qualification-responses", HTMLElement),
  qualificationErrors: byId("qualification-errors", HTMLElement),
  qualificationChecks: byId("qualification-checks", HTMLOListElement),
  qualificationNotes: byId("qualification-notes", HTMLTextAreaElement),
  qualificationReadinessTitle: byId("qualification-readiness-title", HTMLElement),
  qualificationBlockers: byId("qualification-blockers", HTMLUListElement),
  qualificationReset: byId("qualification-reset", HTMLButtonElement),
  qualificationExport: byId("qualification-export", HTMLButtonElement),
};

let trainer: Trainer | undefined;
let trainerKind: "real" | "simulator" | undefined;
let subscriptions: Unsubscribe[] = [];
const logs: LogEntry[] = [];
const observedErrors = new WeakSet();
const powerSamples: number[] = [];
const cadenceSamples: number[] = [];
let lastTelemetryAt: number | undefined;
let realTrainerConnected = false;
const qualificationStartedAt = new Date().toISOString();
const qualificationSession: QualificationSession = {
  source: "trainer-lab",
  startedAt: qualificationStartedAt,
  realConnectionCount: 0,
  telemetrySamples: 0,
  controlResponses: 0,
  errorCount: 0,
};
const qualificationChecks = createEmptyQualificationChecks();

function detectBrowser(): { browser: string; version: string } {
  const candidates: [string, RegExp][] = [
    ["Edge", /Edg\/([\d.]+)/],
    ["Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari/],
  ];
  for (const [browser, pattern] of candidates) {
    const match = pattern.exec(navigator.userAgent);
    if (match?.[1]) return { browser, version: match[1] };
  }
  return { browser: "Unknown", version: "Unknown" };
}

function detectOperatingSystem(): string {
  const userAgent = navigator.userAgent;
  const mac = /Mac OS X ([\d_]+)/.exec(userAgent);
  if (mac?.[1]) return `macOS ${mac[1].replaceAll("_", ".")}`;
  const windows = /Windows NT ([\d.]+)/.exec(userAgent);
  if (windows?.[1]) return `Windows NT ${windows[1]}`;
  const android = /Android ([\d.]+)/.exec(userAgent);
  if (android?.[1]) return `Android ${android[1]}`;
  if (userAgent.includes("Linux")) return "Linux";
  return "Unknown";
}

const detectedBrowser = detectBrowser();
const qualificationMetadata: QualificationMetadata = {
  packageVersion: __FTMS_PACKAGE_VERSION__,
  sourceCommit: __SOURCE_COMMIT__,
  runtimeFingerprint: __RUNTIME_FINGERPRINT__,
  manufacturer: "",
  model: "",
  firmware: "",
  resistanceControlFormat: "sint16",
  operatingSystem: detectOperatingSystem(),
  browser: detectedBrowser.browser,
  browserVersion: detectedBrowser.version,
  secureContext: window.isSecureContext,
  notes: "",
};
let safetyAcknowledged = false;

const QUALIFICATION_STORAGE_KEY = "open-trainer-qualification-v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function restoreQualification(): void {
  try {
    const raw = localStorage.getItem(QUALIFICATION_STORAGE_KEY);
    if (!raw) return;
    const saved: unknown = JSON.parse(raw);
    if (!isRecord(saved)) return;
    if (saved.resistanceControlFormat === "sint16" || saved.resistanceControlFormat === "uint8") {
      qualificationMetadata.resistanceControlFormat = saved.resistanceControlFormat;
    }
    if (isRecord(saved.metadata)) {
      for (const key of [
        "manufacturer",
        "model",
        "firmware",
        "operatingSystem",
        "browser",
        "browserVersion",
        "notes",
      ] as const) {
        const value = saved.metadata[key];
        if (typeof value === "string") qualificationMetadata[key] = value;
      }
    }
    if (
      saved.runtimeFingerprint === qualificationMetadata.runtimeFingerprint &&
      isRecord(saved.checks)
    ) {
      for (const check of QUALIFICATION_CHECKS) {
        const value = saved.checks[check.id];
        if (!isRecord(value)) continue;
        qualificationChecks[check.id] = {
          passed: false,
          notes: typeof value.notes === "string" ? value.notes : "",
        };
      }
    }
  } catch {
    localStorage.removeItem(QUALIFICATION_STORAGE_KEY);
  }
}

function persistQualification(): void {
  localStorage.setItem(
    QUALIFICATION_STORAGE_KEY,
    JSON.stringify({
      runtimeFingerprint: qualificationMetadata.runtimeFingerprint,
      resistanceControlFormat: qualificationMetadata.resistanceControlFormat,
      metadata: qualificationMetadata,
      checks: Object.fromEntries(
        QUALIFICATION_CHECKS.map(({ id }) => [id, { notes: qualificationChecks[id].notes }]),
      ),
    }),
  );
}

function log(message: string, kind: LogKind = "info"): void {
  const entry = { at: new Date().toISOString(), kind, message };
  logs.push(entry);
  if (logs.length > 500) logs.shift();
  const item = document.createElement("li");
  item.textContent = `${entry.at.slice(11, 19)}  ${message}`;
  if (kind === "error") item.className = "error";
  ui.log.prepend(item);
  while (ui.log.children.length > 80) ui.log.lastElementChild?.remove();
}

function logTrainerError(error: unknown, kind = trainerKind): void {
  if (typeof error === "object" && error !== null) {
    if (observedErrors.has(error)) return;
    observedErrors.add(error);
  }
  if (kind === "real") qualificationSession.errorCount += 1;
  log(error instanceof Error ? error.message : String(error), "error");
  renderQualificationStatus();
}

function bind(next: Trainer, kind: "real" | "simulator"): void {
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  trainer = next;
  trainerKind = kind;
  subscriptions = [
    next.connection.subscribe((state) => {
      renderState(next);
      renderSnapshot();
      log(`Connection: ${state}`, state === "error" ? "error" : "info");
    }),
    next.control.subscribe((state) => {
      renderState(next);
      renderSnapshot();
      log(`Control: ${state}`);
    }),
    next.activity.subscribe((state) => {
      renderState(next);
      renderSnapshot();
      log(`Activity: ${state}`);
    }),
    next.telemetry.subscribe((value) => {
      if (value) {
        lastTelemetryAt = Date.now();
        renderTelemetry(value);
        if (kind === "real") qualificationSession.telemetrySamples += 1;
      }
      renderSnapshot();
      renderQualificationStatus();
    }),
    next.capabilities.subscribe((value) => {
      renderCapabilities(value);
      renderSnapshot();
    }),
    next.controlResponses.subscribe(({ requestOpcode, resultCode }) => {
      if (kind === "real") qualificationSession.controlResponses += 1;
      log(
        `Control response 0x${requestOpcode.toString(16).padStart(2, "0")}: result 0x${resultCode.toString(16).padStart(2, "0")}`,
      );
      renderQualificationStatus();
    }),
    next.errors.subscribe((error) => {
      logTrainerError(error, kind);
    }),
  ];
  renderState(next);
  renderSnapshot();
}

async function connect(kind: "real" | "simulator"): Promise<void> {
  if (
    trainer &&
    trainer.connection.current !== "disconnected" &&
    trainer.connection.current !== "error"
  )
    return;
  const resistanceControlFormat = ui.resistanceFormat.value === "uint8" ? "uint8" : "sint16";
  qualificationMetadata.resistanceControlFormat = resistanceControlFormat;
  persistQualification();
  const next =
    kind === "real"
      ? createWebBluetoothTrainer({}, { resistanceControlFormat })
      : createMockTrainer({ resistanceControlFormat }, { resistanceControlFormat });
  bind(next, kind);
  log(kind === "real" ? "Opening Bluetooth device chooser." : "Starting simulated trainer.");

  try {
    await next.connect();
    ui.deviceName.textContent = next.deviceName ?? "Unnamed FTMS trainer";
    if (kind === "real") {
      realTrainerConnected = true;
      qualificationSession.realConnectionCount += 1;
      renderQualificationStatus();
    }
    log(`Connected to ${next.deviceName ?? "FTMS trainer"}.`);
  } catch (error) {
    logTrainerError(error, kind);
  }
}

async function run(label: string, operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
    log(label);
  } catch (error) {
    logTrainerError(error);
  }
}

function renderState(value: Trainer): void {
  const connection = value.connection.current;
  const control = value.control.current;
  const activity = value.activity.current;
  const status =
    connection !== "ready"
      ? connection
      : activity !== "idle"
        ? activity
        : control === "owned"
          ? "controlling"
          : "connected";
  ui.status.textContent = status.charAt(0).toUpperCase() + status.slice(1);
  ui.statusDot.className = `status-dot ${status}`;
  const inactive = connection === "disconnected" || connection === "error";
  const commandReady = connection === "ready" && control === "owned";

  ui.connectReal.disabled = !inactive;
  ui.connectSimulator.disabled = !inactive;
  ui.resistanceFormat.disabled = !inactive;
  ui.disconnect.disabled = inactive || connection === "connecting";
  ui.requestControl.disabled =
    connection !== "ready" || control === "requesting" || control === "owned";
  ui.start.disabled = !commandReady || !(activity === "idle" || activity === "paused");
  ui.pause.disabled = !commandReady || activity !== "running";
  ui.reset.disabled = !commandReady;
  ui.stop.disabled =
    !commandReady || !(activity === "running" || activity === "paused" || activity === "stopping");

  for (const form of [ui.powerForm, ui.resistanceForm, ui.gradeForm]) {
    const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
    if (button) button.disabled = !commandReady;
  }
}

function renderTelemetry(value: TrainerTelemetry): void {
  const power = value.instantaneousPowerWatts;
  const cadence = value.instantaneousCadenceRpm;
  ui.power.textContent = power === undefined ? "—" : Math.round(power).toString();
  ui.cadence.textContent = cadence === undefined ? "—" : Math.round(cadence).toString();
  ui.speed.textContent =
    value.instantaneousSpeedKph === undefined ? "—" : value.instantaneousSpeedKph.toFixed(1);
  ui.distance.textContent =
    value.totalDistanceMeters === undefined ? "—" : (value.totalDistanceMeters / 1000).toFixed(2);

  powerSamples.push(power ?? 0);
  cadenceSamples.push(cadence ?? 0);
  if (powerSamples.length > 60) powerSamples.shift();
  if (cadenceSamples.length > 60) cadenceSamples.shift();
  drawChart();
}

function renderCapabilities(value: TrainerCapabilities | null): void {
  ui.capabilities.className = "capabilities";
  ui.capabilities.replaceChildren();
  if (!value) {
    ui.capabilities.className = "capabilities empty-state";
    ui.capabilities.textContent = "Connect a trainer to inspect its FTMS features.";
    return;
  }
  const entries: [string, boolean | string][] = [
    ["Power measurement", value.supportsPowerMeasurement],
    ["Cadence", value.supportsCadence],
    ["Resistance measurement", value.supportsResistanceMeasurement],
    ["ERG power target", value.supportsPowerTarget],
    ["Resistance target", value.supportsResistanceTarget],
    ["Grade simulation", value.supportsSimulation],
    ["Spindown", value.supportsSpindown],
  ];
  if (value.powerRange)
    entries.push(["Power range", `${value.powerRange.minimum}–${value.powerRange.maximum} W`]);
  if (value.resistanceRange)
    entries.push([
      "Resistance range",
      `${value.resistanceRange.minimum}–${value.resistanceRange.maximum}`,
    ]);

  for (const [label, supported] of entries) {
    const item = document.createElement("span");
    item.className = `capability ${supported === true ? "yes" : ""}`;
    item.textContent =
      typeof supported === "boolean"
        ? `${supported ? "✓" : "×"} ${label}`
        : `${label}: ${supported}`;
    ui.capabilities.append(item);
  }

  if (value.powerRange) {
    ui.powerInput.min = String(value.powerRange.minimum);
    ui.powerInput.max = String(value.powerRange.maximum);
    ui.powerInput.step = String(value.powerRange.increment);
  }
  if (value.resistanceRange) {
    ui.resistanceInput.min = String(value.resistanceRange.minimum);
    ui.resistanceInput.max = String(value.resistanceRange.maximum);
    ui.resistanceInput.step = String(value.resistanceRange.increment);
  }
}

function getDebugSnapshot(): object {
  return {
    capturedAt: new Date().toISOString(),
    deviceName: trainer?.deviceName ?? null,
    connection: trainer?.connection.current ?? "disconnected",
    control: trainer?.control.current ?? "unavailable",
    activity: trainer?.activity.current ?? "idle",
    capabilities: trainer?.capabilities.current ?? null,
    telemetry: trainer?.telemetry.current ?? null,
  };
}

function renderSnapshot(): void {
  ui.connectionState.textContent = trainer?.connection.current ?? "disconnected";
  ui.controlState.textContent = trainer?.control.current ?? "unavailable";
  ui.activityState.textContent = trainer?.activity.current ?? "idle";
  if (!lastTelemetryAt || !trainer?.telemetry.current) {
    ui.packetAge.textContent = "—";
  } else {
    const ageSeconds = Math.max(0, (Date.now() - lastTelemetryAt) / 1000);
    ui.packetAge.textContent =
      ageSeconds < 10 ? `${ageSeconds.toFixed(1)} s` : `${Math.round(ageSeconds)} s`;
  }
  ui.snapshot.textContent = JSON.stringify(getDebugSnapshot(), null, 2);
}

function drawChart(): void {
  const canvas = ui.chart;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#263223";
  context.lineWidth = ratio;
  for (let row = 1; row < 5; row += 1) {
    const y = (height / 5) * row;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  const plot = (samples: number[], max: number, color: string): void => {
    if (samples.length < 2) return;
    context.beginPath();
    context.strokeStyle = color;
    context.lineWidth = 2 * ratio;
    samples.forEach((sample, index) => {
      const x = (index / 59) * width;
      const y = height - Math.min(sample / max, 1) * (height - 12 * ratio) - 6 * ratio;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  };
  plot(powerSamples, 500, "#c8ff44");
  plot(cadenceSamples, 130, "#52d9d2");
}

function downloadJson(filename: string, value: object): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function qualificationInput(): QualificationReadinessInput {
  return {
    safetyAcknowledged,
    realTrainerConnected,
    metadata: qualificationMetadata,
    session: qualificationSession,
    checks: qualificationChecks,
  };
}

function syncQualificationInputs(): void {
  ui.qualificationSafety.checked = safetyAcknowledged;
  ui.resistanceFormat.value = qualificationMetadata.resistanceControlFormat;
  ui.qualificationManufacturer.value = qualificationMetadata.manufacturer;
  ui.qualificationModel.value = qualificationMetadata.model;
  ui.qualificationFirmware.value = qualificationMetadata.firmware;
  ui.qualificationOs.value = qualificationMetadata.operatingSystem;
  ui.qualificationBrowser.value = qualificationMetadata.browser;
  ui.qualificationBrowserVersion.value = qualificationMetadata.browserVersion;
  ui.qualificationNotes.value = qualificationMetadata.notes;
  ui.qualificationPackageVersion.textContent = qualificationMetadata.packageVersion;
  ui.qualificationSecureContext.textContent = qualificationMetadata.secureContext ? "yes" : "no";
  ui.qualificationSecureContext.className = qualificationMetadata.secureContext ? "pass" : "fail";
}

function renderQualificationChecks(): void {
  ui.qualificationChecks.replaceChildren();
  QUALIFICATION_CHECKS.forEach((check, index) => {
    const item = document.createElement("li");
    item.className = "qualification-check";

    const body = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = `${index + 1}. ${check.title}`;
    const procedure = document.createElement("p");
    procedure.textContent = check.procedure;
    const expected = document.createElement("p");
    expected.className = "qualification-expected";
    expected.textContent = `Pass when: ${check.passingObservation}`;
    body.append(heading, procedure, expected);

    const evidence = document.createElement("div");
    evidence.className = "qualification-evidence";
    const passLabel = document.createElement("label");
    passLabel.className = "qualification-pass";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = qualificationChecks[check.id].passed;
    checkbox.disabled = !safetyAcknowledged;
    checkbox.dataset.qualificationCheck = check.id;
    const passText = document.createElement("span");
    passText.textContent = "Observed pass";
    passLabel.append(checkbox, passText);

    const notesLabel = document.createElement("label");
    notesLabel.textContent = "Observation notes";
    const notes = document.createElement("textarea");
    notes.rows = 3;
    notes.value = qualificationChecks[check.id].notes;
    notes.placeholder = check.notePrompt;
    notes.dataset.qualificationNotes = check.id;
    notesLabel.append(notes);
    evidence.append(passLabel, notesLabel);
    item.append(body, evidence);
    ui.qualificationChecks.append(item);

    checkbox.addEventListener("change", () => {
      qualificationChecks[check.id].passed = checkbox.checked;
      persistQualification();
      renderQualificationStatus();
    });
    notes.addEventListener("input", () => {
      qualificationChecks[check.id].notes = notes.value;
      persistQualification();
      renderQualificationStatus();
    });
  });
}

function renderQualificationStatus(): void {
  const passed = QUALIFICATION_CHECKS.filter(({ id }) => qualificationChecks[id].passed).length;
  const blockers = qualificationBlockers(qualificationInput());
  ui.qualificationProgress.textContent = `${passed} / ${QUALIFICATION_CHECKS.length} passed`;
  ui.qualificationProgress.className = `progress-badge ${blockers.length === 0 ? "complete" : ""}`;
  ui.qualificationConnections.textContent = `${qualificationSession.realConnectionCount} / 10`;
  ui.qualificationTelemetry.textContent = String(qualificationSession.telemetrySamples);
  ui.qualificationResponses.textContent = String(qualificationSession.controlResponses);
  ui.qualificationErrors.textContent = String(qualificationSession.errorCount);
  ui.qualificationExport.disabled = blockers.length > 0;
  ui.qualificationReadinessTitle.textContent =
    blockers.length === 0 ? "Passing report is ready" : "Report is not ready";
  ui.qualificationBlockers.replaceChildren();
  const visibleBlockers = blockers.slice(0, 6);
  for (const blocker of visibleBlockers) {
    const item = document.createElement("li");
    item.textContent = blocker;
    ui.qualificationBlockers.append(item);
  }
  if (blockers.length > visibleBlockers.length) {
    const item = document.createElement("li");
    item.textContent = `${blockers.length - visibleBlockers.length} more requirement(s) remain.`;
    ui.qualificationBlockers.append(item);
  }
}

function resetQualification(): void {
  safetyAcknowledged = false;
  realTrainerConnected = false;
  qualificationSession.startedAt = new Date().toISOString();
  qualificationSession.realConnectionCount = 0;
  qualificationSession.telemetrySamples = 0;
  qualificationSession.controlResponses = 0;
  qualificationSession.errorCount = 0;
  qualificationMetadata.manufacturer = "";
  qualificationMetadata.model = "";
  qualificationMetadata.firmware = "";
  qualificationMetadata.resistanceControlFormat = "sint16";
  qualificationMetadata.notes = "";
  for (const check of QUALIFICATION_CHECKS) {
    qualificationChecks[check.id] = { passed: false, notes: "" };
  }
  localStorage.removeItem(QUALIFICATION_STORAGE_KEY);
  syncQualificationInputs();
  renderQualificationChecks();
  renderQualificationStatus();
  log("Physical qualification checklist cleared.");
}

ui.connectReal.addEventListener("click", () => void connect("real"));
ui.connectSimulator.addEventListener("click", () => void connect("simulator"));
ui.disconnect.addEventListener("click", () => {
  const current = trainer;
  if (!current) return;
  void run("Disconnected.", () => current.disconnect());
});
ui.requestControl.addEventListener("click", () => {
  const current = trainer;
  if (current) void run("Control granted.", () => current.acquireControl());
});
ui.start.addEventListener("click", () => {
  const current = trainer;
  if (current) void run("Training started.", () => current.start());
});
ui.pause.addEventListener("click", () => {
  const current = trainer;
  if (current) void run("Training paused.", () => current.pause());
});
ui.reset.addEventListener("click", () => {
  const current = trainer;
  if (current) void run("Trainer reset.", () => current.reset());
});
ui.stop.addEventListener("click", () => {
  const current = trainer;
  if (current) void run("Resistance stopped.", () => current.stop());
});

ui.powerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const watts = ui.powerInput.valueAsNumber;
  const current = trainer;
  if (current) void run(`ERG target set to ${watts} W.`, () => current.setTargetPower(watts));
});
ui.resistanceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const level = ui.resistanceInput.valueAsNumber;
  const current = trainer;
  if (current)
    void run(`Resistance level set to ${level}.`, () => current.setResistanceLevel(level));
});
ui.gradeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const gradePercent = ui.gradeInput.valueAsNumber;
  const current = trainer;
  if (current) {
    void run(`Simulated grade set to ${gradePercent}%.`, () =>
      current.setSimulation({ gradePercent }),
    );
  }
});

ui.copySnapshot.addEventListener("click", () => {
  void (async () => {
    try {
      const clipboard = Reflect.get(navigator, "clipboard") as Clipboard | undefined;
      if (!clipboard) throw new Error("Clipboard access is unavailable in this browser context.");
      await clipboard.writeText(JSON.stringify(getDebugSnapshot(), null, 2));
      log("Copied the current library snapshot.");
    } catch (error) {
      log(error instanceof Error ? error.message : "Could not copy snapshot.", "error");
    }
  })();
});

ui.clearLog.addEventListener("click", () => {
  logs.splice(0);
  ui.log.replaceChildren();
  log("Session log cleared.");
});

ui.downloadLog.addEventListener("click", () => {
  const bundle = { exportedAt: new Date().toISOString(), snapshot: getDebugSnapshot(), logs };
  downloadJson(`trainer-lab-${new Date().toISOString().replaceAll(":", "-")}.json`, bundle);
});

ui.resistanceFormat.addEventListener("change", () => {
  qualificationMetadata.resistanceControlFormat =
    ui.resistanceFormat.value === "uint8" ? "uint8" : "sint16";
  persistQualification();
  renderQualificationStatus();
});

ui.qualificationSafety.addEventListener("change", () => {
  safetyAcknowledged = ui.qualificationSafety.checked;
  persistQualification();
  renderQualificationChecks();
  renderQualificationStatus();
});

for (const [input, key] of [
  [ui.qualificationManufacturer, "manufacturer"],
  [ui.qualificationModel, "model"],
  [ui.qualificationFirmware, "firmware"],
  [ui.qualificationOs, "operatingSystem"],
  [ui.qualificationBrowser, "browser"],
  [ui.qualificationBrowserVersion, "browserVersion"],
  [ui.qualificationNotes, "notes"],
] as const) {
  input.addEventListener("input", () => {
    qualificationMetadata[key] = input.value;
    persistQualification();
    renderQualificationStatus();
  });
}

ui.qualificationReset.addEventListener("click", () => {
  if (window.confirm("Clear every physical qualification check and note?")) resetQualification();
});

ui.qualificationExport.addEventListener("click", () => {
  const input = qualificationInput();
  const blockers = qualificationBlockers(input);
  if (blockers.length > 0) {
    log(`Qualification report is blocked: ${blockers[0]}`, "error");
    return;
  }
  const report = buildQualificationReport(input);
  downloadJson(qualificationReportFilename(qualificationMetadata), report);
  log("Exported a passing, sanitized physical qualification report.");
});

window.addEventListener("resize", drawChart);
window.addEventListener("beforeunload", () => {
  if (trainer && trainer.connection.current !== "disconnected") void trainer.disconnect();
});
const initialTrainer = createMockTrainer();
restoreQualification();
syncQualificationInputs();
renderQualificationChecks();
renderQualificationStatus();
renderState(initialTrainer);
renderSnapshot();
drawChart();
log("Trainer Companion ready. The simulator requires no hardware.");
setInterval(renderSnapshot, 1_000);
