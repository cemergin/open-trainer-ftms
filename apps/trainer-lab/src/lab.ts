import { byId } from "./ui/dom";
import {
  bluetoothSupported,
  createLabConnection,
  readLabTraceFile,
  LabReplay,
  type LabConnection,
  type LabFault,
  type CommandEvent,
  type MachineStatus,
  copyText,
  downloadText,
  type Trainer,
  type TrainerCapabilities,
  type TrainerTelemetry,
  type Unsubscribe,
  type ValueRange,
} from "./services";
import { LabControls, packetHex } from "./lab-diagnostics";
import { createQualificationPanel } from "./qualification-panel";
import "./lab.css";
import "./qualification.css";

interface LogEntry {
  at: string;
  kind: "info" | "error";
  message: string;
}
interface PacketEntry {
  at: string;
  source: string;
  bytes: number[];
  hex: string;
  description: string;
}
const button = (id: string): HTMLButtonElement => byId(id, HTMLButtonElement);
const input = (id: string): HTMLInputElement => byId(id, HTMLInputElement);
const text = (id: string, value: string): void => {
  byId(id).textContent = value;
};
const telemetryIds = [
  "power",
  "cadence",
  "speed",
  "distance",
  "heart-rate",
  "energy",
  "elapsed",
  "measured-resistance",
];
const logs: LogEntry[] = [];
const packets: PacketEntry[] = [];
const observedErrors = new WeakSet();
const samples: { power: number | undefined; cadence: number | undefined }[] = [];
let trainer: Trainer | undefined;
let controls: LabControls | undefined;
let subscriptions: Unsubscribe[] = [];
let connecting = false;
let disconnecting = false;
let simulator = false;
let replaying = false;
let replay: LabReplay | undefined;
let labConnection: LabConnection | undefined;
const commandEvents: CommandEvent[] = [];
const decodedStatuses: MachineStatus[] = [];
let lastTelemetryAt: number | undefined;
let actionSerial = 0;
let pendingLabel = "";
const qualification = createQualificationPanel(log);
const supportsBluetooth = bluetoothSupported();
byId("browser-help").hidden = supportsBluetooth;

function log(message: string, kind: LogEntry["kind"] = "info"): void {
  const entry = { at: new Date().toISOString(), kind, message };
  logs.push(entry);
  if (logs.length > 500) logs.shift();
  const item = document.createElement("li");
  item.textContent = `${entry.at.slice(11, 19)} · ${message}`;
  item.className = kind;
  byId("log").prepend(item);
  while (byId("log").children.length > 100) byId("log").lastElementChild?.remove();
}

function showError(error: unknown): void {
  if (typeof error === "object" && error !== null) {
    if (observedErrors.has(error)) return;
    observedErrors.add(error);
  }
  qualification.error(!simulator);
  const message = error instanceof Error ? error.message : String(error);
  text("message", message);
  byId("message").hidden = false;
  log(message, "error");
}

function recordPacket(source: string, bytes: Uint8Array, description: string): void {
  const packet = {
    at: new Date().toISOString(),
    source,
    bytes: Array.from(bytes),
    hex: packetHex(bytes),
    description,
  };
  packets.push(packet);
  if (packets.length > 100) packets.shift();
  const item = document.createElement("li");
  const heading = document.createElement("span");
  heading.textContent = `${packet.at.slice(11, 19)} · ${source} · ${description}`;
  const hex = document.createElement("code");
  hex.textContent = packet.hex || "(empty packet)";
  item.append(heading, hex);
  byId("packets").prepend(item);
  while (byId("packets").children.length > 40) byId("packets").lastElementChild?.remove();
  byId("packet-empty").hidden = true;
}

function clearTelemetry(): void {
  lastTelemetryAt = undefined;
  samples.splice(0);
  for (const id of telemetryIds) text(id, "—");
  renderExtraTelemetry(null);
  renderFreshness();
  drawChart();
}

function bind(next: Trainer): void {
  const real = !simulator;
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  trainer = next;
  controls = new LabControls(next, simulator && !replaying);
  commandEvents.splice(0);
  decodedStatuses.splice(0);
  byId("command-events").replaceChildren();
  text("decoded-status", "No machine status received.");
  clearTelemetry();
  packets.splice(0);
  byId("packets").replaceChildren();
  byId("packet-empty").hidden = false;
  subscriptions = [
    next.connection.subscribe((state) => {
      if (state !== "ready") clearTelemetry();
      renderState();
      renderSnapshot();
      log(`Connection: ${state}`, state === "error" ? "error" : "info");
    }),
    next.control.subscribe((state) => {
      renderState();
      renderSnapshot();
      log(`Control: ${state}`);
      if (state === "revoked")
        showError(
          "Trainer control was lost. Further commands may be rejected; take control again before continuing.",
        );
    }),
    next.activity.subscribe((state) => {
      renderState();
      renderSnapshot();
      log(`Activity: ${state}`);
    }),
    next.telemetry.subscribe((value) => {
      if (value) {
        lastTelemetryAt = Date.now();
        renderTelemetry(value);
        qualification.telemetry(real);
      } else clearTelemetry();
      renderSnapshot();
      renderTraceStatus();
    }),
    next.capabilities.subscribe((value) => {
      renderCapabilities(value);
      renderState();
      renderSnapshot();
    }),
    next.controlResponses.subscribe((response) => {
      qualification.response(real);
      const results: Record<number, string> = {
        1: "Success",
        2: "Not supported",
        3: "Invalid parameter",
        4: "Operation failed",
        5: "Control not permitted",
      };
      const label = results[response.resultCode] ?? `Unknown result ${response.resultCode}`;
      recordPacket(
        "Control point",
        Uint8Array.of(
          response.responseOpcode,
          response.requestOpcode,
          response.resultCode,
          ...response.responseParameters,
        ),
        `command 0x${response.requestOpcode.toString(16).padStart(2, "0")} · ${label}`,
      );
      log(
        `Control acknowledgement: 0x${response.requestOpcode.toString(16).padStart(2, "0")} · ${label}`,
        response.resultCode === 1 ? "info" : "error",
      );
    }),
    next.machineStatus.subscribe((bytes) => {
      recordPacket(
        "Machine status",
        bytes,
        bytes[0] === 0xff ? "Control permission lost" : "Raw FTMS status",
      );
      log(`Machine status: ${packetHex(bytes) || "empty packet"}`);
    }),
    next.commandEvents.subscribe((event) => {
      commandEvents.push(event);
      if (commandEvents.length > 100) commandEvents.shift();
      const item = document.createElement("li");
      item.textContent = `#${event.id} · 0x${event.opcode.toString(16).padStart(2, "0")} · ${event.phase} · ${event.elapsedMs.toFixed(1)} ms elapsed${event.latencyMs === undefined ? "" : ` · ${event.latencyMs.toFixed(1)} ms since dispatch`}${event.errorCode ? ` · ${event.errorCode}` : ""}`;
      byId("command-events").prepend(item);
      while (byId("command-events").children.length > 40)
        byId("command-events").lastElementChild?.remove();
    }),
    next.machineStatusEvents.subscribe((status) => {
      decodedStatuses.push(status);
      if (decodedStatuses.length > 100) decodedStatuses.shift();
      text(
        "decoded-status",
        JSON.stringify(
          { kind: status.kind, decodedParameters: status.decodedParameters ?? null },
          null,
          2,
        ),
      );
      log(
        `Parsed machine status: ${status.kind}${status.decodedParameters ? ` · ${JSON.stringify(status.decodedParameters)}` : ""}`,
      );
      if (status.kind === "spin-down-status")
        text(
          "spindown-status",
          `Trainer reports: ${status.decodedParameters?.status ?? "unknown"}.`,
        );
    }),
    next.errors.subscribe((error) => {
      if (!replay?.isStopped) showError(error);
    }),
  ];
}

async function connect(useSimulator: boolean): Promise<void> {
  if (connecting || disconnecting || replaying || trainer?.connection.current === "ready") return;
  connecting = true;
  simulator = useSimulator;
  byId("message").hidden = true;
  actionSerial += 1;
  try {
    const fault = byId("fault-mode", HTMLSelectElement).value as LabFault;
    labConnection = createLabConnection(simulator, qualification.resistanceControlFormat, fault);
    const next = labConnection.trainer;
    bind(next);
    log(
      simulator
        ? "Starting simulator. No physical trainer is controlled."
        : "Opening the Bluetooth trainer chooser.",
    );
    const pending = next.connect();
    renderState();
    await pending;
    qualification.connected(!simulator, next.deviceName);
    log(`Connected to ${next.deviceName ?? "FTMS trainer"}.`);
  } catch (error) {
    showError(
      error instanceof Error && error.name === "NotFoundError"
        ? new Error(
            "No trainer selected. Power it on, close other trainer apps, and connect again.",
          )
        : error,
    );
  } finally {
    connecting = false;
    renderState();
    renderSnapshot();
  }
}

async function perform(label: string, operation: () => Promise<unknown>): Promise<void> {
  const serial = ++actionSerial;
  pendingLabel = label;
  byId("message").hidden = true;
  log(`${label} requested.`);
  try {
    const pending = operation();
    renderState();
    const result = await pending;
    log(result === false ? `${label} cancelled.` : `${label} acknowledged.`);
  } catch (error) {
    if (serial === actionSerial) showError(error);
    else log(error instanceof Error ? error.message : String(error), "error");
  } finally {
    renderState();
    renderSnapshot();
  }
}

function renderState(): void {
  const connection = trainer?.connection.current ?? "disconnected";
  const control = trainer?.control.current ?? "unavailable";
  const activity = trainer?.activity.current ?? "idle";
  const ready = connection === "ready";
  const busy = (controls?.busy ?? false) || connecting || disconnecting || replaying;
  const targetsBlocked =
    (controls?.targetsBlocked ?? false) || connecting || disconnecting || replaying;
  const owned = ready && control === "owned";
  const caps = trainer?.capabilities.current;
  text(
    "status",
    connecting
      ? "Connecting…"
      : ready
        ? "Connected"
        : connection === "error"
          ? "Connection failed"
          : "Disconnected",
  );
  byId("status-dot").classList.toggle("connected", ready);
  text(
    "device-name",
    ready ? (trainer?.deviceName ?? "Unnamed FTMS trainer") : "No device connected",
  );
  byId("simulator-badge").hidden = !simulator || !ready;
  text(
    "simulator-badge",
    replaying
      ? "OFFLINE REPLAY · NO PHYSICAL BIKE CONTROL"
      : "SIMULATOR · NO PHYSICAL BIKE CONTROL",
  );
  byId("fault-mode", HTMLSelectElement).disabled = busy || ready;
  input("trace-import").disabled = busy || ready;
  button("stop-replay").hidden = !replaying;
  renderTraceStatus();
  button("spindown-start").disabled = !owned || busy || !caps?.supportsSpindown;
  button("spindown-ignore").disabled = !owned || busy || !caps?.supportsSpindown;
  text(
    "spindown-support",
    !caps
      ? "Connect to check support"
      : caps.supportsSpindown
        ? "Supported by this trainer"
        : "Not advertised by this trainer",
  );
  byId("simulator-test").hidden = !simulator || !ready || replaying;
  button("connect-real").disabled = busy || ready || !supportsBluetooth;
  button("connect-simulator").disabled = busy || ready;
  button("disconnect").disabled = !ready || busy;
  button("request-control").disabled = !ready || busy || control === "owned";
  button("start").disabled = !owned || busy || activity === "running";
  button("pause").disabled = !owned || busy || activity !== "running";
  button("reset").disabled = !owned || busy;
  byId("resistance-format", HTMLSelectElement).disabled = busy || ready;
  button("stop").disabled = !ready || Boolean(controls?.stopping) || disconnecting || replaying;
  button("stop").textContent = controls?.stopping ? "Stopping…" : "■ Stop";
  button("test-sequence").disabled =
    !ready || busy || !simulator || !caps?.supportsPowerTarget || activity === "running";
  const forms = [
    ["power-form", "target-power", "power-support", caps?.supportsPowerTarget],
    ["resistance-form", "resistance", "resistance-support", caps?.supportsResistanceTarget],
    ["grade-form", "grade", "grade-support", caps?.supportsSimulation],
    ["cadence-form", "target-cadence", "cadence-support", caps?.supportsTargetCadence],
  ] as const;
  for (const [formId, inputId, supportId, supported] of forms) {
    input(inputId).disabled = !owned || targetsBlocked || !supported;
    const submit = byId(formId).querySelector("button");
    if (submit) submit.disabled = !owned || targetsBlocked || !supported;
    text(
      supportId,
      !caps
        ? "Connect to check support"
        : supported
          ? "Supported by this trainer"
          : "Not advertised by this trainer",
    );
  }
  text(
    "command-hint",
    controls?.stopping
      ? "Stop queued. Waiting for the trainer’s acknowledgement…"
      : replaying
        ? "Replaying recorded commands offline. Use Stop replay to end playback."
        : controls?.pending
          ? `${pendingLabel} pending… Stop remains available.`
          : owned
            ? "Control owned. Set a low target before starting."
            : ready
              ? "Connected. Take control before sending targets."
              : "Connect a trainer, then take control.",
  );
  text("connection-state", connection);
  text("control-state", control);
  text("activity-state", activity);
}

function renderTraceStatus(): void {
  button("export-trace").disabled = !labConnection?.recording.capturedEventCount;
  text(
    "trace-state",
    replaying && replay
      ? `${replay.remainingEvents} offline protocol events remaining.`
      : labConnection
        ? `${labConnection.recording.capturedEventCount} raw events in memory${labConnection.recording.isTruncated ? " · recording incomplete (limit or transport failure)" : ""}`
        : "No raw recording yet.",
  );
}

function number(value: number | undefined, decimals = 0): string {
  return value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(decimals);
}

function renderTelemetry(value: TrainerTelemetry): void {
  const values = [
    number(value.instantaneousPowerWatts),
    number(value.instantaneousCadenceRpm),
    number(value.instantaneousSpeedKph, 1),
    number(
      value.totalDistanceMeters === undefined ? undefined : value.totalDistanceMeters / 1000,
      2,
    ),
    number(value.heartRateBpm),
    number(value.totalEnergyKcal),
    number(value.elapsedTimeSeconds),
    number(value.resistanceLevel, 1),
  ];
  telemetryIds.forEach((id, i) => text(id, values[i] ?? "—"));
  samples.push({ power: value.instantaneousPowerWatts, cadence: value.instantaneousCadenceRpm });
  if (samples.length > 60) samples.shift();
  renderExtraTelemetry(value);
  renderFreshness();
  drawChart();
}

function renderDataList(id: string, entries: [string, string][]): void {
  const fragment = document.createDocumentFragment();
  for (const [label, value] of entries) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value;
    row.append(term, detail);
    fragment.append(row);
  }
  byId(id).replaceChildren(fragment);
}

function renderExtraTelemetry(value: TrainerTelemetry | null): void {
  renderDataList("extra-telemetry", [
    ["Average speed", `${number(value?.averageSpeedKph, 1)} km/h`],
    ["Average cadence", `${number(value?.averageCadenceRpm, 1)} rpm`],
    ["Average power", `${number(value?.averagePowerWatts)} W`],
    ["Energy per hour", `${number(value?.energyPerHourKcal)} kcal/h`],
    ["Energy per minute", `${number(value?.energyPerMinuteKcal, 1)} kcal/min`],
    ["Metabolic equivalent", number(value?.metabolicEquivalent, 1)],
    ["Remaining time", `${number(value?.remainingTimeSeconds)} s`],
    ["Parsed timestamp", value ? new Date(value.timestamp).toISOString() : "—"],
  ]);
}

function configureRange(id: string, range: ValueRange | undefined, fallback: ValueRange): void {
  const field = input(id);
  const limits = range ?? fallback;
  field.min = String(limits.minimum);
  field.max = String(limits.maximum);
  field.step = limits.increment > 0 ? String(limits.increment) : "any";
  let value = Math.max(
    limits.minimum,
    Math.min(limits.maximum, field.valueAsNumber || limits.minimum),
  );
  if (limits.increment > 0) {
    const steps = Math.min(
      Math.round((value - limits.minimum) / limits.increment),
      Math.floor((limits.maximum - limits.minimum) / limits.increment),
    );
    value = limits.minimum + steps * limits.increment;
  }
  field.value = String(Number(value.toFixed(6)));
}

function renderCapabilities(value: TrainerCapabilities | null): void {
  byId("capabilities").replaceChildren();
  const features: [string, boolean | undefined][] = [
    ["Power measurement", value?.supportsPowerMeasurement],
    ["Cadence", value?.supportsCadence],
    ["Resistance measurement", value?.supportsResistanceMeasurement],
    ["ERG power target", value?.supportsPowerTarget],
    ["Resistance target", value?.supportsResistanceTarget],
    ["Grade simulation", value?.supportsSimulation],
    ["Spindown", value?.supportsSpindown],
    ["Target cadence", value?.supportsTargetCadence],
  ];
  for (const [label, supported] of features) {
    const tag = document.createElement("span");
    tag.className = `capability${supported ? " supported" : ""}`;
    tag.textContent = `${supported === undefined ? "—" : supported ? "✓" : "×"} ${label}`;
    byId("capabilities").append(tag);
  }
  const rangeText = (range: ValueRange | undefined, unit: string): string =>
    range
      ? `${range.minimum}–${range.maximum} ${unit} · increment ${range.increment}`
      : "Not reported";
  const hex = (flag: number | undefined): string =>
    flag === undefined ? "—" : `0x${(flag >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
  renderDataList("feature-flags", [
    ["Machine feature flags", hex(value?.machineFeatures)],
    ["Target feature flags", hex(value?.targetSettingFeatures)],
    ["Power range", rangeText(value?.powerRange, "W")],
    ["Resistance range", rangeText(value?.resistanceRange, "level")],
  ]);
  configureRange("target-power", value?.powerRange, { minimum: 0, maximum: 1800, increment: 1 });
  configureRange("resistance", value?.resistanceRange, { minimum: 0, maximum: 20, increment: 0.1 });
}

function renderFreshness(): void {
  const age =
    lastTelemetryAt === undefined ? undefined : Math.max(0, Date.now() - lastTelemetryAt) / 1000;
  text("packet-age", age === undefined ? "—" : `${age.toFixed(1)} s`);
  text("freshness", age === undefined ? "NO DATA" : age > 5 ? "STALE DATA" : "LIVE DATA");
  byId("freshness").classList.toggle("live", age !== undefined && age <= 5);
  document.querySelector(".metrics")?.classList.toggle("stale", age !== undefined && age > 5);
  text(
    "last-packet",
    lastTelemetryAt === undefined
      ? "No telemetry packet received. A dash means the trainer has not reported that field."
      : `Last received ${new Date(lastTelemetryAt).toLocaleTimeString()} · ${simulator ? "simulated" : "trainer"} data${age !== undefined && age > 5 ? " · values show the last packet" : ""}`,
  );
}

function snapshot(): object {
  return {
    capturedAt: new Date().toISOString(),
    build: {
      packageVersion: __FTMS_PACKAGE_VERSION__,
      sourceCommit: __SOURCE_COMMIT__,
      runtimeFingerprint: __RUNTIME_FINGERPRINT__,
    },
    simulator,
    replaying,
    deviceName: trainer?.deviceName ?? null,
    connection: trainer?.connection.current ?? "disconnected",
    control: trainer?.control.current ?? "unavailable",
    activity: trainer?.activity.current ?? "idle",
    pendingCommand: controls?.busy ? pendingLabel : null,
    lastTelemetryReceivedAt:
      lastTelemetryAt === undefined ? null : new Date(lastTelemetryAt).toISOString(),
    capabilities: trainer?.capabilities.current ?? null,
    telemetry: trainer?.telemetry.current ?? null,
  };
}
function renderSnapshot(): void {
  text("snapshot", JSON.stringify(snapshot(), null, 2));
}

function drawChart(): void {
  const canvas = byId("chart", HTMLCanvasElement);
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;
  const css = getComputedStyle(document.documentElement);
  context.strokeStyle = css.getPropertyValue("--color-border").trim();
  context.lineWidth = ratio;
  for (let row = 1; row < 5; row++) {
    const y = (height / 5) * row;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  const plot = (key: "power" | "cadence", maximum: number, token: string): void => {
    context.beginPath();
    context.strokeStyle = css.getPropertyValue(token).trim();
    context.lineWidth = 2 * ratio;
    let previous = false;
    samples.forEach((sample, index) => {
      const value = sample[key];
      if (value === undefined) {
        previous = false;
        return;
      }
      const x = (index / 59) * width;
      const y =
        height - Math.max(0, Math.min(value / maximum, 1)) * (height - 12 * ratio) - 6 * ratio;
      if (previous) context.lineTo(x, y);
      else context.moveTo(x, y);
      previous = true;
    });
    context.stroke();
  };
  plot("power", 500, "--color-accent");
  plot("cadence", 130, "--color-warning");
}

function download(name: string, value: object): void {
  downloadText(
    JSON.stringify(value, null, 2),
    `${name}-${new Date().toISOString().replaceAll(":", "-")}.json`,
    "application/json",
  );
  log(`${name} download requested.`);
}

button("connect-real").addEventListener("click", () => void connect(false));
button("connect-simulator").addEventListener("click", () => void connect(true));
button("disconnect").addEventListener(
  "click",
  () =>
    void perform("Disconnect", async () => {
      disconnecting = true;
      try {
        await trainer?.disconnect();
      } finally {
        disconnecting = false;
        clearTelemetry();
      }
    }),
);
for (const [id, label, operation] of [
  ["request-control", "Take control", (current: Trainer) => current.acquireControl()],
  ["start", "Start / resume", (current: Trainer) => current.start()],
  ["pause", "Pause", (current: Trainer) => current.pause()],
  ["reset", "Reset trainer", (current: Trainer) => current.reset()],
] as const)
  button(id).addEventListener("click", () => {
    const current = trainer;
    const desk = controls;
    if (current && desk) void perform(label, () => desk.run(() => operation(current)));
  });
button("stop").addEventListener("click", () => {
  const desk = controls;
  if (desk) void perform("Stop", () => desk.stop());
});
button("test-sequence").addEventListener("click", () => {
  const desk = controls;
  if (desk) void perform("80 W simulator test", () => desk.simulatorSequence());
});
for (const [formId, inputId, label, operation] of [
  [
    "power-form",
    "target-power",
    "Power target",
    (current: Trainer, value: number) => current.setTargetPower(value),
  ],
  [
    "resistance-form",
    "resistance",
    "Resistance target",
    (current: Trainer, value: number) => current.setResistanceLevel(value),
  ],
  [
    "cadence-form",
    "target-cadence",
    "Cadence target",
    (current: Trainer, value: number) => current.setTargetCadence(value),
  ],
  [
    "grade-form",
    "grade",
    "Grade target",
    (current: Trainer, value: number) => current.setSimulation({ gradePercent: value }),
  ],
] as const)
  byId(formId, HTMLFormElement).addEventListener("submit", (event) => {
    event.preventDefault();
    const field = input(inputId);
    const current = trainer;
    const desk = controls;
    if (!current || !desk || field.disabled || !field.reportValidity()) return;
    void perform(`${label}: ${field.value}`, () =>
      desk.runTarget(() => operation(current, field.valueAsNumber)),
    );
  });

for (const [id, control] of [
  ["spindown-start", "start"],
  ["spindown-ignore", "ignore"],
] as const) {
  button(id).addEventListener("click", () => {
    const current = trainer;
    const desk = controls;
    if (!current || !desk || button(id).disabled) return;
    text("spindown-status", "Awaiting machine-status updates.");
    void perform(`Spin-down ${control}`, () =>
      desk.run(async () => {
        const response = await current.spinDown(control);
        text(
          "spindown-target",
          `Request accepted. Trainer target speed: ${response.targetSpeedLowKph}–${response.targetSpeedHighKph} km/h. Wait for machine-status results; acceptance does not confirm calibration completion.`,
        );
      }),
    );
  });
}
button("export-trace").addEventListener("click", () => {
  if (!labConnection) return;
  try {
    download("ftms-raw-trace", labConnection.recording.trace);
  } catch (error) {
    showError(error);
  }
});
input("trace-import").addEventListener("change", () => {
  const file = input("trace-import").files?.[0];
  if (!file || trainer?.connection.current === "ready" || connecting || disconnecting || replaying)
    return;
  void (async () => {
    connecting = true;
    renderState();
    try {
      const trace = await readLabTraceFile(file);
      replay = new LabReplay(trace);
      replaying = true;
      simulator = true;
      labConnection = undefined;
      bind(replay.trainer);
      connecting = false;
      renderState();
      log(
        `Offline replay started: ${trace.events.length} protocol events. No hardware is connected.`,
      );
      await replay.play((message) => log(`Recorded rejection: ${message}`, "error"));
      log(
        replay.remainingEvents
          ? "Offline replay stopped."
          : "Offline replay completed; all recorded commands matched.",
      );
    } catch (error) {
      showError(error);
    } finally {
      connecting = false;
      replaying = false;
      replay = undefined;
      input("trace-import").value = "";
      renderState();
      renderSnapshot();
    }
  })();
});
button("stop-replay").addEventListener("click", () => {
  replay?.stop();
});

button("copy-snapshot").addEventListener("click", () => {
  void (async () => {
    try {
      await copyText(JSON.stringify(snapshot(), null, 2));
      log("Snapshot copied.");
    } catch (error) {
      showError(error);
    }
  })();
});
button("download-snapshot").addEventListener("click", () => {
  try {
    download("trainer-snapshot", snapshot());
  } catch (error) {
    showError(error);
  }
});
button("download-log").addEventListener("click", () => {
  try {
    download("trainer-diagnostics", {
      schemaVersion: 1,
      snapshot: snapshot(),
      packets,
      commandEvents,
      decodedStatuses,
      logs,
    });
  } catch (error) {
    showError(error);
  }
});
button("clear-log").addEventListener("click", () => {
  logs.splice(0);
  packets.splice(0);
  byId("log").replaceChildren();
  byId("packets").replaceChildren();
  byId("packet-empty").hidden = false;
  log("Event and packet histories cleared.");
});
window.addEventListener("resize", drawChart);
window.addEventListener("beforeunload", () => {
  replay?.stop();
  void trainer?.disconnect().catch(() => undefined);
});
renderCapabilities(null);
clearTelemetry();
renderState();
renderSnapshot();
log("Trainer Lab ready. Nothing controls your trainer until you request it.");
setInterval(renderFreshness, 1000);
