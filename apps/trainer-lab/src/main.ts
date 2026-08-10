import type {
  Trainer,
  TrainerCapabilities,
  TrainerTelemetry,
  Unsubscribe,
} from "@open-trainer/ftms";
import { createMockTrainer } from "@open-trainer/ftms/testing";
import { createWebBluetoothTrainer } from "@open-trainer/ftms/web-bluetooth";
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
  requestControl: byId("request-control", HTMLButtonElement),
  start: byId("start", HTMLButtonElement),
  pause: byId("pause", HTMLButtonElement),
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
};

let trainer: Trainer | undefined;
let subscriptions: Unsubscribe[] = [];
const logs: LogEntry[] = [];
const powerSamples: number[] = [];
const cadenceSamples: number[] = [];
let lastTelemetryAt: number | undefined;

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

function bind(next: Trainer): void {
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  trainer = next;
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
      }
      renderSnapshot();
    }),
    next.capabilities.subscribe((value) => {
      renderCapabilities(value);
      renderSnapshot();
    }),
    next.controlResponses.subscribe(({ requestOpcode, resultCode }) => {
      log(
        `Control response 0x${requestOpcode.toString(16).padStart(2, "0")}: result 0x${resultCode.toString(16).padStart(2, "0")}`,
      );
    }),
    next.errors.subscribe((error) => log(error.message, "error")),
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
  const next = kind === "real" ? createWebBluetoothTrainer() : createMockTrainer();
  bind(next);
  log(kind === "real" ? "Opening Bluetooth device chooser." : "Starting simulated trainer.");

  try {
    await next.connect();
    ui.deviceName.textContent = next.deviceName ?? "Unnamed FTMS trainer";
    log(`Connected to ${next.deviceName ?? "FTMS trainer"}.`);
  } catch (error) {
    log(error instanceof Error ? error.message : String(error), "error");
  }
}

async function run(label: string, operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
    log(label);
  } catch (error) {
    log(error instanceof Error ? error.message : String(error), "error");
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
  ui.disconnect.disabled = inactive || connection === "connecting";
  ui.requestControl.disabled =
    connection !== "ready" || control === "requesting" || control === "owned";
  ui.start.disabled = !commandReady || !(activity === "idle" || activity === "paused");
  ui.pause.disabled = !commandReady || activity !== "running";
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
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `trainer-lab-${new Date().toISOString().replaceAll(":", "-")}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

window.addEventListener("resize", drawChart);
window.addEventListener("beforeunload", () => {
  if (trainer && trainer.connection.current !== "disconnected") void trainer.disconnect();
});
const initialTrainer = createMockTrainer();
renderState(initialTrainer);
renderSnapshot();
drawChart();
log("Trainer Companion ready. The simulator requires no hardware.");
setInterval(renderSnapshot, 1_000);
