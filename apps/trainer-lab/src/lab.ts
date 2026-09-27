import { bluetoothSupported, createTrainerConnection, copyText, downloadText, type Trainer, type TrainerCapabilities, type TrainerTelemetry, type Unsubscribe, type ValueRange } from "./services";
import { LabControls, packetHex } from "./lab-diagnostics";
import "./lab.css";

type LogEntry = { at: string; kind: "info" | "error"; message: string };
type PacketEntry = { at: string; source: string; bytes: number[]; hex: string; description: string };
const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
};
const button = (id: string) => byId<HTMLButtonElement>(id);
const input = (id: string) => byId<HTMLInputElement>(id);
const text = (id: string, value: string) => { byId(id).textContent = value; };
const telemetryIds = ["power", "cadence", "speed", "distance", "heart-rate", "energy", "elapsed", "measured-resistance"];
const logs: LogEntry[] = [];
const packets: PacketEntry[] = [];
const samples: Array<{ power: number | undefined; cadence: number | undefined }> = [];
let trainer: Trainer | undefined;
let controls: LabControls | undefined;
let subscriptions: Unsubscribe[] = [];
let connecting = false;
let disconnecting = false;
let simulator = false;
let lastTelemetryAt: number | undefined;
let actionSerial = 0;
let pendingLabel = "";
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
  const message = error instanceof Error ? error.message : String(error);
  text("message", message);
  byId("message").hidden = false;
  log(message, "error");
}

function recordPacket(source: string, bytes: Uint8Array, description: string): void {
  const packet = { at: new Date().toISOString(), source, bytes: Array.from(bytes), hex: packetHex(bytes), description };
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
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  trainer = next;
  controls = new LabControls(next, simulator);
  clearTelemetry();
  packets.splice(0);
  byId("packets").replaceChildren();
  byId("packet-empty").hidden = false;
  subscriptions = [
    next.connection.subscribe(state => {
      if (state !== "ready") clearTelemetry();
      renderState();
      renderSnapshot();
      log(`Connection: ${state}`, state === "error" ? "error" : "info");
    }),
    next.control.subscribe(state => {
      renderState(); renderSnapshot(); log(`Control: ${state}`);
      if (state === "revoked") showError("Trainer control was lost. Further commands may be rejected; take control again before continuing.");
    }),
    next.activity.subscribe(state => { renderState(); renderSnapshot(); log(`Activity: ${state}`); }),
    next.telemetry.subscribe(value => {
      if (value) { lastTelemetryAt = Date.now(); renderTelemetry(value); }
      else clearTelemetry();
      renderSnapshot();
    }),
    next.capabilities.subscribe(value => { renderCapabilities(value); renderState(); renderSnapshot(); }),
    next.controlResponses.subscribe(response => {
      const results: Record<number, string> = { 1: "Success", 2: "Not supported", 3: "Invalid parameter", 4: "Operation failed", 5: "Control not permitted" };
      const label = results[response.resultCode] ?? `Unknown result ${response.resultCode}`;
      recordPacket("Control point", Uint8Array.of(response.responseOpcode, response.requestOpcode, response.resultCode, ...response.responseParameters), `command 0x${response.requestOpcode.toString(16).padStart(2, "0")} · ${label}`);
      log(`Control acknowledgement: 0x${response.requestOpcode.toString(16).padStart(2, "0")} · ${label}`, response.resultCode === 1 ? "info" : "error");
    }),
    next.machineStatus.subscribe(bytes => {
      recordPacket("Machine status", bytes, bytes[0] === 0xff ? "Control permission lost" : "Raw FTMS status");
      log(`Machine status: ${packetHex(bytes) || "empty packet"}`);
    }),
    next.errors.subscribe(showError),
  ];
}

async function connect(useSimulator: boolean): Promise<void> {
  if (connecting || disconnecting || trainer?.connection.current === "ready") return;
  connecting = true;
  simulator = useSimulator;
  byId("message").hidden = true;
  actionSerial += 1;
  try {
    const next = createTrainerConnection(simulator);
    bind(next);
    log(simulator ? "Starting simulator. No physical trainer is controlled." : "Opening the Bluetooth trainer chooser.");
    const pending = next.connect();
    renderState();
    await pending;
    log(`Connected to ${next.deviceName ?? "FTMS trainer"}.`);
  } catch (error) {
    showError(error instanceof Error && error.name === "NotFoundError" ? new Error("No trainer selected. Power it on, close other trainer apps, and connect again.") : error);
  } finally {
    connecting = false;
    renderState(); renderSnapshot();
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
    log(result === false ? `${label}: remaining steps cancelled by Stop.` : `${label} acknowledged.`);
  } catch (error) {
    if (serial === actionSerial) showError(error);
    else log(error instanceof Error ? error.message : String(error), "error");
  } finally {
    renderState(); renderSnapshot();
  }
}

function renderState(): void {
  const connection = trainer?.connection.current ?? "disconnected";
  const control = trainer?.control.current ?? "unavailable";
  const activity = trainer?.activity.current ?? "idle";
  const ready = connection === "ready";
  const busy = Boolean(controls?.busy || connecting || disconnecting);
  const owned = ready && control === "owned";
  const caps = trainer?.capabilities.current;
  text("status", connecting ? "Connecting…" : ready ? "Connected" : connection === "error" ? "Connection failed" : "Disconnected");
  byId("status-dot").classList.toggle("connected", ready);
  text("device-name", ready ? trainer?.deviceName ?? "Unnamed FTMS trainer" : "No device connected");
  byId("simulator-badge").hidden = !simulator || !ready;
  byId("simulator-test").hidden = !simulator || !ready;
  button("connect-real").disabled = busy || ready || !supportsBluetooth;
  button("connect-simulator").disabled = busy || ready;
  button("disconnect").disabled = !ready || busy;
  button("request-control").disabled = !ready || busy || control === "owned";
  button("start").disabled = !owned || busy || activity === "running";
  button("pause").disabled = !owned || busy || activity !== "running";
  button("stop").disabled = !ready || Boolean(controls?.stopping) || disconnecting;
  button("stop").textContent = controls?.stopping ? "Stopping…" : "■ Stop";
  button("test-sequence").disabled = !ready || busy || !simulator || !caps?.supportsPowerTarget || activity === "running";
  const forms = [
    ["power-form", "target-power", "power-support", caps?.supportsPowerTarget],
    ["resistance-form", "resistance", "resistance-support", caps?.supportsResistanceTarget],
    ["grade-form", "grade", "grade-support", caps?.supportsSimulation],
  ] as const;
  for (const [formId, inputId, supportId, supported] of forms) {
    input(inputId).disabled = !owned || busy || !supported;
    byId(formId).querySelector<HTMLButtonElement>("button")!.disabled = !owned || busy || !supported;
    text(supportId, !caps ? "Connect to check support" : supported ? "Supported by this trainer" : "Not advertised by this trainer");
  }
  text("command-hint", controls?.stopping ? "Stop queued. Waiting for the trainer’s acknowledgement…" : controls?.pending ? `${pendingLabel} pending… Stop remains available.` : owned ? "Control owned. Set a low target before starting." : ready ? "Connected. Take control before sending targets." : "Connect a trainer, then take control.");
  text("connection-state", connection);
  text("control-state", control);
  text("activity-state", activity);
}

function number(value: number | undefined, decimals = 0): string {
  return value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(decimals);
}

function renderTelemetry(value: TrainerTelemetry): void {
  const values = [number(value.instantaneousPowerWatts), number(value.instantaneousCadenceRpm), number(value.instantaneousSpeedKph, 1), number(value.totalDistanceMeters === undefined ? undefined : value.totalDistanceMeters / 1000, 2), number(value.heartRateBpm), number(value.totalEnergyKcal), number(value.elapsedTimeSeconds), number(value.resistanceLevel, 1)];
  telemetryIds.forEach((id, i) => text(id, values[i]!));
  samples.push({ power: value.instantaneousPowerWatts, cadence: value.instantaneousCadenceRpm });
  if (samples.length > 60) samples.shift();
  renderExtraTelemetry(value);
  renderFreshness();
  drawChart();
}

function renderDataList(id: string, entries: Array<[string, string]>): void {
  const fragment = document.createDocumentFragment();
  for (const [label, value] of entries) {
    const row = document.createElement("div");
    const term = document.createElement("dt"); term.textContent = label;
    const detail = document.createElement("dd"); detail.textContent = value;
    row.append(term, detail); fragment.append(row);
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
  field.min = String(limits.minimum); field.max = String(limits.maximum);
  field.step = limits.increment > 0 ? String(limits.increment) : "any";
  let value = Math.max(limits.minimum, Math.min(limits.maximum, field.valueAsNumber || limits.minimum));
  if (limits.increment > 0) {
    const steps = Math.min(Math.round((value - limits.minimum) / limits.increment), Math.floor((limits.maximum - limits.minimum) / limits.increment));
    value = limits.minimum + steps * limits.increment;
  }
  field.value = String(Number(value.toFixed(6)));
}

function renderCapabilities(value: TrainerCapabilities | null): void {
  byId("capabilities").replaceChildren();
  const features: Array<[string, boolean | undefined]> = [
    ["Power measurement", value?.supportsPowerMeasurement], ["Cadence", value?.supportsCadence],
    ["Resistance measurement", value?.supportsResistanceMeasurement], ["ERG power target", value?.supportsPowerTarget],
    ["Resistance target", value?.supportsResistanceTarget], ["Grade simulation", value?.supportsSimulation],
    ["Spindown", value?.supportsSpindown], ["Target cadence", value?.supportsTargetCadence],
  ];
  for (const [label, supported] of features) {
    const tag = document.createElement("span");
    tag.className = `capability${supported ? " supported" : ""}`;
    tag.textContent = `${supported === undefined ? "—" : supported ? "✓" : "×"} ${label}`;
    byId("capabilities").append(tag);
  }
  const rangeText = (range: ValueRange | undefined, unit: string) => range ? `${range.minimum}–${range.maximum} ${unit} · increment ${range.increment}` : "Not reported";
  const hex = (flag: number | undefined) => flag === undefined ? "—" : `0x${(flag >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
  renderDataList("feature-flags", [["Machine feature flags", hex(value?.machineFeatures)], ["Target feature flags", hex(value?.targetSettingFeatures)], ["Power range", rangeText(value?.powerRange, "W")], ["Resistance range", rangeText(value?.resistanceRange, "level")]]);
  configureRange("target-power", value?.powerRange, { minimum: 0, maximum: 1800, increment: 1 });
  configureRange("resistance", value?.resistanceRange, { minimum: 0, maximum: 20, increment: 0.1 });
}

function renderFreshness(): void {
  const age = lastTelemetryAt === undefined ? undefined : Math.max(0, Date.now() - lastTelemetryAt) / 1000;
  text("packet-age", age === undefined ? "—" : `${age.toFixed(1)} s`);
  text("freshness", age === undefined ? "NO DATA" : age > 5 ? "STALE DATA" : "LIVE DATA");
  byId("freshness").classList.toggle("live", age !== undefined && age <= 5);
  document.querySelector(".metrics")?.classList.toggle("stale", age !== undefined && age > 5);
  text("last-packet", lastTelemetryAt === undefined ? "No telemetry packet received. A dash means the trainer has not reported that field." : `Last received ${new Date(lastTelemetryAt).toLocaleTimeString()} · ${simulator ? "simulated" : "trainer"} data${age! > 5 ? " · values show the last packet" : ""}`);
}

function snapshot(): object {
  return { capturedAt: new Date().toISOString(), simulator, deviceName: trainer?.deviceName ?? null, connection: trainer?.connection.current ?? "disconnected", control: trainer?.control.current ?? "unavailable", activity: trainer?.activity.current ?? "idle", pendingCommand: controls?.busy ? pendingLabel : null, lastTelemetryReceivedAt: lastTelemetryAt === undefined ? null : new Date(lastTelemetryAt).toISOString(), capabilities: trainer?.capabilities.current ?? null, telemetry: trainer?.telemetry.current ?? null };
}
function renderSnapshot(): void { text("snapshot", JSON.stringify(snapshot(), null, 2)); }

function drawChart(): void {
  const canvas = byId<HTMLCanvasElement>("chart");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;
  const css = getComputedStyle(document.documentElement);
  context.strokeStyle = css.getPropertyValue("--color-border").trim();
  context.lineWidth = ratio;
  for (let row = 1; row < 5; row++) {
    const y = height / 5 * row;
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
  }
  const plot = (key: "power" | "cadence", maximum: number, token: string): void => {
    context.beginPath(); context.strokeStyle = css.getPropertyValue(token).trim(); context.lineWidth = 2 * ratio;
    let previous = false;
    samples.forEach((sample, index) => {
      const value = sample[key];
      if (value === undefined) { previous = false; return; }
      const x = index / 59 * width;
      const y = height - Math.max(0, Math.min(value / maximum, 1)) * (height - 12 * ratio) - 6 * ratio;
      if (previous) context.lineTo(x, y); else context.moveTo(x, y);
      previous = true;
    });
    context.stroke();
  };
  plot("power", 500, "--color-accent"); plot("cadence", 130, "--color-warning");
}

function download(name: string, value: object): void {
  downloadText(JSON.stringify(value, null, 2), `${name}-${new Date().toISOString().replaceAll(":", "-")}.json`, "application/json");
  log(`${name} download requested.`);
}

button("connect-real").addEventListener("click", () => void connect(false));
button("connect-simulator").addEventListener("click", () => void connect(true));
button("disconnect").addEventListener("click", () => void perform("Disconnect", async () => {
  disconnecting = true;
  try { await trainer?.disconnect(); } finally { disconnecting = false; clearTelemetry(); }
}));
for (const [id, label, operation] of [
  ["request-control", "Take control", () => trainer!.acquireControl()],
  ["start", "Start / resume", () => trainer!.start()],
  ["pause", "Pause", () => trainer!.pause()],
] as const) button(id).addEventListener("click", () => { if (controls) void perform(label, () => controls!.run(operation)); });
button("stop").addEventListener("click", () => { if (controls) void perform("Stop", () => controls!.stop()); });
button("test-sequence").addEventListener("click", () => { if (controls) void perform("80 W simulator test", () => controls!.simulatorSequence()); });
for (const [formId, inputId, label, operation] of [
  ["power-form", "target-power", "Power target", (value: number) => trainer!.setTargetPower(value)],
  ["resistance-form", "resistance", "Resistance target", (value: number) => trainer!.setResistanceLevel(value)],
  ["grade-form", "grade", "Grade target", (value: number) => trainer!.setSimulation({ gradePercent: value })],
] as const) byId<HTMLFormElement>(formId).addEventListener("submit", event => {
  event.preventDefault();
  const field = input(inputId);
  if (!controls || field.disabled || !field.reportValidity()) return;
  void perform(`${label}: ${field.value}`, () => controls!.run(() => operation(field.valueAsNumber)));
});

button("copy-snapshot").addEventListener("click", () => {
  void (async () => {
    try { await copyText(JSON.stringify(snapshot(), null, 2)); log("Snapshot copied."); }
    catch (error) { showError(error); }
  })();
});
button("download-snapshot").addEventListener("click", () => { try { download("trainer-snapshot", snapshot()); } catch (error) { showError(error); } });
button("download-log").addEventListener("click", () => { try { download("trainer-diagnostics", { schemaVersion: 1, snapshot: snapshot(), packets, logs }); } catch (error) { showError(error); } });
button("clear-log").addEventListener("click", () => { logs.splice(0); packets.splice(0); byId("log").replaceChildren(); byId("packets").replaceChildren(); byId("packet-empty").hidden = false; log("Event and packet histories cleared."); });
window.addEventListener("resize", drawChart);
window.addEventListener("beforeunload", () => { void trainer?.disconnect().catch(() => undefined); });
renderCapabilities(null); clearTelemetry(); renderState(); renderSnapshot();
log("Trainer Lab ready. Nothing controls your trainer until you request it.");
setInterval(renderFreshness, 1000);
