import { mountTrainingTools } from "./training-tools";
import { supportsMode } from "./ride-control";
import { Ride, type RideStatus, type RideRecord } from "./ride";
import {
  createWorkout,
  currentStep,
  formatTime,
  trainerWatts,
  suggestedTarget,
  WORKOUT_OPTIONS,
  type WorkoutMode,
  type Workout,
} from "./workout";
import {
  createTrainerConnection,
  bluetoothSupported,
  keepScreenAwake,
  loadRide,
  saveRide,
  rideCsv,
  listRides,
  loadCheckpoint,
  saveCheckpoint,
  clearCheckpoint,
  exportAllData,
  downloadText,
  type Trainer,
} from "./services";
import { renderFeedback } from "./ui/feedback";
import { mountWorkoutPicker } from "./ui/workout-picker";
import { renderRideHistory } from "./ui/history";
import { renderLiveChart } from "./ui/live-chart";
import { byId } from "./ui/dom";
import "./style.css";
import "./training.css";
import "./ui/live-chart.css";

const ui = {
  connect: byId("connect-real", HTMLButtonElement),
  demo: byId("connect-simulator", HTMLButtonElement),
  disconnect: byId("disconnect", HTMLButtonElement),
  start: byId("start", HTMLButtonElement),
  pause: byId("pause", HTMLButtonElement),
  stop: byId("stop", HTMLButtonElement),
  down: byId("power-down", HTMLButtonElement),
  up: byId("power-up", HTMLButtonElement),
  watts: byId("base-power", HTMLInputElement),
  duration: byId("duration", HTMLSelectElement),
  options: byId("workout-options", HTMLFieldSetElement),
  profile: byId("workout-profile"),
  summary: byId("summary"),
  newRide: byId("new-ride", HTMLButtonElement),
};
mountWorkoutPicker(ui.options);
let historyRecords = listRides();
let recovery = loadCheckpoint();
let historyKey = "";
let trainer: Trainer | undefined;
let ride: Ride | undefined;
let connecting = false;
let appError = "";
let previousRecord = loadRide();
let savedAt = 0;
let savedStatus = "";
let savedToDevice = true;
let archivedRideId: string | undefined;
let profileKey = "";
const supportsBluetooth = bluetoothSupported();
byId("browser-help").hidden = supportsBluetooth;
const training = mountTrainingTools({
  run: act,
  runRide: (operation) =>
    act(async () => {
      await operation();
      persistRide(true);
    }),
  selectedWorkout,
  refresh: render,
  reload: () => {
    if (trainer && ride?.status === "finished") {
      const simulator = ride.simulator;
      ride.dispose();
      ride = newRide(trainer, simulator);
      savedAt = 0;
      savedStatus = "";
    }
    historyRecords = listRides();
    recovery = loadCheckpoint();
    previousRecord = loadRide();
    historyKey = "";
    training.refreshStorage();
    render();
  },
});
training.refreshStorage();
function newRide(trainer: Trainer, simulator: boolean): Ride {
  return new Ride(
    trainer,
    simulator,
    Date.now,
    (value) => training.sensors.applyToTelemetry(value, simulator),
    () => training.sensors.sourceSnapshot(simulator),
  );
}

function text(id: string, value: string): void {
  const element = byId(id);
  if (element.textContent !== value) element.textContent = value;
}
function mode(): WorkoutMode {
  const selected = document.querySelector<HTMLInputElement>('input[name="workout"]:checked')?.value;
  return WORKOUT_OPTIONS.find((option) => option.id === selected)?.id ?? "endurance";
}
function automaticTarget(): number {
  const previous = historyRecords.find(
    (record) => record.completed && !record.simulator && record.averagePower !== null,
  );
  return suggestedTarget(mode(), previous?.averagePower ?? undefined);
}
function selectedWorkout(): Workout {
  if (training.customWorkout) return training.customWorkout;
  const watts =
    training.options.controlMode !== "erg" || ui.watts.value.trim() === ""
      ? automaticTarget()
      : ui.watts.valueAsNumber;
  return createWorkout(mode(), Number(ui.duration.value), watts);
}
function previewWorkout(): Workout {
  try {
    return selectedWorkout();
  } catch {
    return createWorkout(mode(), Number(ui.duration.value), 100);
  }
}

function showRecoveredWorkout(): void {
  const workout = ride?.workout;
  if (!workout) return;
  const sources = ride?.record().sourceChanges?.at(-1)?.sources;
  if (sources)
    for (const metric of ["power", "cadence", "heartRate"] as const)
      training.sensors.selectSource(metric, sources[metric].source);
  const selected = WORKOUT_OPTIONS.find((option) => option.name === workout.name);
  if (selected) {
    const input = ui.options.querySelector<HTMLInputElement>(`input[value="${selected.id}"]`);
    if (input) input.checked = true;
  }
  const minutes = String((workout.seconds ?? 0) / 60);
  if ([...ui.duration.options].some((option) => option.value === minutes))
    ui.duration.value = minutes;
  window.scrollTo(0, 0);
}

async function connect(simulator: boolean, recover = false): Promise<void> {
  if (connecting || trainer?.connection.current === "ready") return;
  connecting = true;
  appError = "";
  persistRide(true);
  savedAt = 0;
  savedStatus = "";
  ride?.dispose();
  try {
    // connect() stays in this click's activation so Chrome can open its Bluetooth chooser.
    const next = createTrainerConnection(simulator);
    trainer = next;
    ride = newRide(next, simulator);
    const pending = next.connect();
    render();
    const capabilities = await pending;
    if (recover && recovery) {
      ride.restore(recovery.workout, recovery.record, recovery.adjustment);
      savedAt = ride.elapsed;
      savedStatus = "paused";
      appError = "Ride recovered and paused. Start pedaling, then press Resume ride.";
      showRecoveredWorkout();
    }
    if (!supportsMode(capabilities, training.options.controlMode ?? "erg"))
      appError = "Connected. Select a ride mode supported by this trainer before starting.";
  } catch (error) {
    appError =
      error instanceof Error && error.name === "NotFoundError"
        ? "No trainer selected. Power it on, close other trainer apps, and try Connect trainer again."
        : `${error instanceof Error ? error.message : String(error)} Check Bluetooth permission and close other trainer apps, then try again.`;
  } finally {
    connecting = false;
    render();
  }
}

async function act(operation: () => void | Promise<void>): Promise<void> {
  appError = "";
  try {
    const pending = operation();
    render();
    await pending;
  } catch (error) {
    appError = error instanceof Error ? error.message : String(error);
  }
  render();
}

function hasUnresolvedRecovery(): boolean {
  return recovery !== null && recovery.record.startedAt !== ride?.startedAt;
}

function actionHint(status: RideStatus, active: boolean, connected: boolean): string {
  if (hasUnresolvedRecovery())
    return "Recover your unfinished ride, or keep it as a past ride before starting another.";
  if (status === "interrupted") return "Disconnect and reconnect before your next ride.";
  if (status === "finished") {
    if (!ride?.elapsed) return "Ready for another try.";
    return savedToDevice ? "Your ride is saved below." : "Download your ride below to keep it.";
  }
  if (ride?.busy) return "Waiting for the trainer…";
  if (active) return "Esc to end · save automatically";
  return connected ? "Start pedaling, then start your ride." : "Connect your trainer to begin.";
}

function render(): void {
  const connected = trainer?.connection.current === "ready";
  const active = ride?.active ?? false;
  const status = ride?.status ?? "ready";
  const ended = status === "finished" || status === "interrupted";
  persistRide();
  const workout = ride?.workout ?? previewWorkout();
  const elapsed = ride?.elapsed ?? 0;
  const workoutElapsed = ride?.workoutElapsed ?? elapsed;
  const stage = currentStep(workout, workoutElapsed);
  const controlMode = ride?.workout ? ride.controlMode : (training.options.controlMode ?? "erg");
  const telemetry = connected ? ride?.telemetry : null;
  const target = ride?.workout
    ? ride.target
    : trainerWatts(stage.step.watts, trainer?.capabilities.current?.powerRange);
  document.body.classList.toggle("riding", active);
  ui.connect.hidden = connected;
  ui.demo.hidden = connected;
  ui.connect.disabled = connecting || !supportsBluetooth;
  ui.demo.disabled = connecting;
  ui.disconnect.hidden = !connected;
  ui.disconnect.disabled = active || Boolean(ride?.busy);
  byId("demo-badge").hidden = !ride?.simulator || !connected;
  byId("connection-dot").classList.toggle("connected", connected);
  text(
    "device-name",
    connecting
      ? "Finding your trainer…"
      : connected
        ? (trainer?.deviceName ?? "FTMS trainer")
        : "Let’s find your trainer",
  );
  text(
    "connection-detail",
    connected
      ? ride?.simulator
        ? "Demo data · your physical trainer is not connected"
        : trainer?.capabilities.current?.supportsPowerTarget
          ? "Bluetooth connected · ERG power control"
          : "Bluetooth connected · ERG unavailable"
      : "Bluetooth FTMS · Chrome or Edge on your computer",
  );
  text(
    "ride-state",
    {
      ready: "STANDBY",
      starting: "STARTING",
      riding: "● RIDING",
      paused: "PAUSED",
      stopping: "STOPPING",
      finished: ride?.elapsed && savedToDevice ? "SAVED" : "ENDED",
      interrupted: "INTERRUPTED",
    }[status],
  );
  byId("ride-state").classList.toggle("live", status === "riding");
  text(
    "ride-label",
    active ? workout.name.toUpperCase() : ended ? "TIME WELL SPENT" : "READY WHEN YOU ARE",
  );
  text(
    "step-name",
    ended
      ? status === "interrupted"
        ? "Let’s check the connection."
        : "That’s your ride."
      : active
        ? stage.step.name
        : "Find your rhythm.",
  );
  text(
    "step-count",
    active
      ? workout.seconds === null
        ? "NO FINISH LINE"
        : `INTERVAL ${stage.index + 1} / ${workout.steps.length}`
      : "A little progress, every day.",
  );
  text(
    "power",
    telemetry?.instantaneousPowerWatts === undefined
      ? "—"
      : String(Math.round(telemetry.instantaneousPowerWatts)),
  );
  text(
    "cadence",
    telemetry?.instantaneousCadenceRpm === undefined
      ? "—"
      : String(Math.round(telemetry.instantaneousCadenceRpm)),
  );
  text(
    "power-caption",
    ride?.simulator && connected
      ? "Simulated power · demo mode"
      : connected && !telemetry
        ? "Waiting for fresh trainer data…"
        : training.sensors.state.current.sources.power === "external"
          ? "Power from your selected external sensor"
          : training.sensors.state.current.sources.power === "none"
            ? "Power source is off"
            : "Live from your trainer",
  );
  const controlTarget =
    controlMode === "erg"
      ? target
      : ride?.workout
        ? ride.controlTarget
        : controlMode === "terrain"
          ? 0
          : 5;
  text(
    "control-label",
    controlMode === "erg"
      ? "TARGET POWER"
      : controlMode === "terrain"
        ? "ROAD GRADE"
        : "RESISTANCE",
  );
  const targetUnit = controlMode === "erg" ? "W" : controlMode === "terrain" ? "%" : "level";
  text("control-unit", targetUnit);
  text("target", String(controlTarget));
  renderFeedback(
    telemetry?.instantaneousPowerWatts,
    controlMode === "erg" ? target : 0,
    telemetry?.instantaneousSpeedKph,
    status === "riding",
  );
  if (controlMode !== "erg") {
    text("feedback-label", controlMode === "terrain" ? "Follow the road" : "Find your effort");
    text(
      "feedback-guidance",
      controlMode === "terrain"
        ? "Shift gears with the grade. Power follows your effort."
        : "Adjust resistance, gears, and cadence to set your effort.",
    );
  }
  byId("ride-feedback").classList.toggle("no-power-target", controlMode !== "erg");
  text("elapsed", formatTime(Math.floor(elapsed)));
  text("total-time", workout.seconds === null ? "elapsed" : `/ ${formatTime(workout.seconds)}`);
  text("remaining", formatTime(stage.remaining));
  text("remaining-label", workout.seconds === null ? "YOUR PACE" : "INTERVAL LEFT");
  const next = workout.steps[stage.index + 1];
  text(
    "next-step",
    next
      ? `next: ${next.name.toLowerCase()}`
      : workout.seconds === null
        ? "ride as long as you like"
        : "finish feeling good",
  );
  ui.start.hidden = (active && status !== "paused") || ended;
  ui.start.disabled =
    !connected ||
    hasUnresolvedRecovery() ||
    !supportsMode(trainer?.capabilities.current, controlMode) ||
    training.sensors.hasMixedSources(ride?.simulator ?? false) ||
    Boolean(ride?.busy) ||
    !ui.watts.checkValidity();
  ui.start.textContent = status === "paused" ? "Resume ride →" : "Start ride →";
  ui.pause.hidden = status !== "riding";
  ui.pause.disabled = Boolean(ride?.busy);
  ui.stop.hidden = !active;
  ui.stop.disabled = status === "stopping";
  ui.stop.textContent = status === "stopping" ? "Stopping…" : "■ End ride";
  ui.up.disabled = ui.down.disabled = !["riding", "paused"].includes(status) || Boolean(ride?.busy);
  const targetStep =
    controlMode === "erg"
      ? Math.max(5, trainer?.capabilities.current?.powerRange?.increment ?? 1)
      : controlMode === "terrain"
        ? 0.5
        : Math.max(1, trainer?.capabilities.current?.resistanceRange?.increment ?? 1);
  ui.down.setAttribute("aria-label", `Decrease target by ${targetStep} ${targetUnit}`);
  ui.up.setAttribute("aria-label", `Increase target by ${targetStep} ${targetUnit}`);
  const stepLabel = document.querySelector(".target-controls span");
  if (stepLabel) stepLabel.textContent = `${targetStep} ${targetUnit}`;
  ui.options.disabled = status !== "ready";
  ui.watts.disabled =
    status !== "ready" || controlMode !== "erg" || Boolean(training.customWorkout);
  byId("power-setting").hidden = controlMode !== "erg";
  byId("target-help").hidden = controlMode !== "erg";
  ui.duration.disabled = status !== "ready" || mode() === "free";
  text("action-hint", actionHint(status, active, connected));
  text(
    "workout-duration",
    workout.seconds === null
      ? `OPEN ENDED · ${controlMode.toUpperCase()}`
      : `${Math.round(workout.seconds / 60)} MIN · ${controlMode.toUpperCase()}`,
  );
  text(
    "profile-end",
    workout.seconds === null ? "YOUR CALL" : `${Math.round(workout.seconds / 60)} MIN`,
  );
  text(
    "target-help",
    ui.watts.value.trim() === ""
      ? `Auto suggests ${automaticTarget()} W for this ride. This is a starting point, not a fitness test. Adjust any time.`
      : "Your own target is selected. Clear the field to let the app choose a starting power.",
  );
  text(
    "setup-footer",
    controlMode !== "erg"
      ? "Power is set by your effort. The selected workout provides timing and cadence cues."
      : mode() === "free"
        ? "Change the target any time with the + and − buttons."
        : `Your warm-up starts gently at ${trainerWatts(currentStep(workout, 0).step.watts, trainer?.capabilities.current?.powerRange)} W.`,
  );
  renderProfile(workout, stage.index, workoutElapsed, active);
  renderLiveChart(ride?.samples ?? [], elapsed, controlMode, status);
  text("distance", `${(ride?.distanceKm ?? 0).toFixed(2)} km`);
  text("average", `${ride?.averagePower ?? "—"} W`);
  text("work", `${Math.round(ride?.workKj ?? 0)} kJ`);
  const error =
    [
      appError,
      ride?.error,
      training.sensors.hasMixedSources(ride?.simulator ?? false)
        ? "Selected sensors and trainer must both use demo data or both use real Bluetooth data. Change the sensor source before riding."
        : "",
      !savedToDevice
        ? "Browser storage is unavailable. Keep this tab open, then end your ride and download its CSV to keep your data."
        : "",
    ].find((value) => value) ?? "";
  byId("message").hidden = !error;
  text("message", error);
  renderSummary(ended);
  renderSavedRides(active);
  void keepScreenAwake(active);
  training.update(ride, trainer, historyRecords);
}

function renderProfile(
  workout: ReturnType<typeof createWorkout>,
  index: number,
  elapsed: number,
  active: boolean,
): void {
  const erg =
    (ride?.workout ? ride.controlMode : (training.options.controlMode ?? "erg")) === "erg";
  const adjustment = erg ? (ride?.adjustment ?? 0) : 0;
  const key = JSON.stringify([workout, adjustment, erg, trainer?.capabilities.current?.powerRange]);
  if (key !== profileKey) {
    profileKey = key;
    ui.profile.replaceChildren();
    const powers = workout.steps.map((step) =>
      trainerWatts(step.watts + adjustment, trainer?.capabilities.current?.powerRange),
    );
    const max = Math.max(100, ...powers);
    workout.steps.forEach((step, i) => {
      const bar = document.createElement("div");
      bar.className = `profile-block ${step.effort}`;
      bar.style.flex = String(Number.isFinite(step.seconds) ? step.seconds : 1);
      const power = powers[i];
      if (power === undefined) throw new Error("Missing workout power.");
      bar.style.height = `${erg ? Math.max(12, (power / max) * 100) : 70}%`;
      bar.title = `${step.name}${erg ? `: ${powers[i]} W` : ""}${Number.isFinite(step.seconds) ? ` · ${formatTime(step.seconds)}` : ""}`;
      ui.profile.append(bar);
    });
    const marker = document.createElement("span");
    marker.className = "profile-marker";
    ui.profile.append(marker);
    ui.profile.setAttribute(
      "aria-label",
      workout.steps
        .map(
          (step, i) =>
            `${step.name}${erg ? `, ${powers[i]} watts` : `, ${formatTime(step.seconds)}`}`,
        )
        .join("; "),
    );
  }
  ui.profile.querySelectorAll(".profile-block").forEach((bar, i) => {
    bar.classList.toggle("current", active && i === index);
    bar.classList.toggle("done", i < index);
  });
  const marker = ui.profile.querySelector<HTMLElement>(".profile-marker");
  if (!marker) throw new Error("Missing workout progress marker.");
  marker.hidden = !ride?.workout || workout.seconds === null;
  marker.style.left = `${Math.min(100, (elapsed / (workout.seconds ?? 1)) * 100)}%`;
}

function persistRide(force = false): void {
  if (
    !ride?.startedAt ||
    hasUnresolvedRecovery() ||
    !ride.workout ||
    ride.elapsed <= 0 ||
    (!force && ride.elapsed - savedAt < 5 && savedStatus === ride.status)
  )
    return;
  previousRecord = ride.record();
  savedAt = ride.elapsed;
  savedStatus = ride.status;
  const reachedEnd = ride.workout.seconds !== null && ride.workoutElapsed >= ride.workout.seconds;
  if (ride.status === "finished" || reachedEnd || ride.startedAt === archivedRideId) {
    savedToDevice = saveRide(previousRecord);
    if (savedToDevice) {
      const cleared = clearCheckpoint();
      if (cleared) recovery = null;
      else
        appError =
          "Ride saved, but recovery data could not be cleared. Export a backup of your rides.";
    }
  } else {
    recovery = {
      version: 1,
      workout: ride.workout,
      record: previousRecord,
      adjustment: ride.adjustment,
      savedAt: new Date().toISOString(),
    };
    savedToDevice = saveCheckpoint(recovery);
  }
  historyRecords = listRides();
}
function downloadRide(record: RideRecord): void {
  downloadText(
    rideCsv(record),
    `open-trainer-${record.simulator ? "demo-" : ""}${record.startedAt.replaceAll(":", "-")}.csv`,
    "text/csv;charset=utf-8",
  );
}
function renderSavedRides(active: boolean): void {
  const card = byId("recovery");
  card.hidden = !recovery || active;
  if (recovery) {
    text(
      "recovery-detail",
      `${recovery.record.simulator ? "Demo · " : ""}${recovery.workout.name} · ${formatTime(Math.floor(recovery.record.seconds))} recorded. Reconnect, then resume when ready.`,
    );
    byId("restore-ride", HTMLButtonElement).disabled =
      connecting || (trainer?.connection.current === "ready" && ride?.status === "interrupted");
  }
  const key = JSON.stringify(
    historyRecords.map((record) => [record.startedAt, record.seconds, record.completed]),
  );
  if (key !== historyKey) {
    historyKey = key;
    renderRideHistory(byId("ride-history"), historyRecords, downloadRide, training);
    training.refreshStorage();
  }
}
function renderSummary(ended: boolean): void {
  ui.summary.hidden = (!previousRecord && ride?.status !== "finished") || Boolean(ride?.active);
  ui.newRide.hidden = ride?.status !== "finished";
  byId("download").hidden = !previousRecord;
  if (!previousRecord) {
    text("summary-label", "NO RIDE DATA RECORDED");
    text("summary-title", "Ready for another try.");
    text("summary-detail", "This attempt ended before ride data was recorded.");
    return;
  }
  const record = previousRecord;
  const currentRecord = ended && record.startedAt === ride?.startedAt;
  text(
    "summary-label",
    savedToDevice
      ? "SAVED ON THIS DEVICE"
      : "DOWNLOAD TO KEEP THIS RIDE · BROWSER STORAGE UNAVAILABLE",
  );
  text(
    "summary-title",
    currentRecord
      ? record.simulator
        ? "Your demo ride."
        : "A ride worth showing up for."
      : "Your last saved ride",
  );
  text(
    "summary-detail",
    `${record.simulator ? "Simulator · " : ""}${record.name} · ${formatTime(Math.floor(record.seconds))} · ${record.averagePower ?? "—"} W average · ${record.distanceKm.toFixed(2)} km · ${record.completed ? "Workout complete" : "Partial ride"}`,
  );
}

ui.connect.addEventListener("click", () => void connect(false));
ui.demo.addEventListener("click", () => void connect(true));
ui.disconnect.addEventListener(
  "click",
  () =>
    void act(async () => {
      await trainer?.disconnect();
    }),
);
ui.start.addEventListener("click", () => {
  const currentRide = ride;
  if (
    !currentRide ||
    hasUnresolvedRecovery() ||
    !ui.watts.reportValidity() ||
    training.sensors.hasMixedSources(currentRide.simulator)
  )
    return;
  const beginning = currentRide.status === "ready";
  void act(() =>
    currentRide.status === "paused"
      ? currentRide.resume()
      : currentRide.start(selectedWorkout(), training.options),
  );
  if (beginning) window.scrollTo(0, 0);
});
ui.pause.addEventListener(
  "click",
  () =>
    void act(async () => {
      await ride?.pause();
    }),
);
ui.stop.addEventListener(
  "click",
  () =>
    void act(async () => {
      await ride?.finish();
    }),
);
ui.down.addEventListener(
  "click",
  () =>
    void act(async () => {
      await ride?.adjust(-5);
      persistRide(true);
    }),
);
ui.up.addEventListener(
  "click",
  () =>
    void act(async () => {
      await ride?.adjust(5);
      persistRide(true);
    }),
);
ui.newRide.addEventListener("click", () => {
  if (!trainer || ride?.status !== "finished") return;
  persistRide(true);
  const simulator = ride.simulator;
  ride.dispose();
  ride = newRide(trainer, simulator);
  savedAt = 0;
  savedStatus = "";
  appError = "";
  render();
});
for (const element of [ui.options, ui.duration, ui.watts])
  element.addEventListener("input", () => {
    training.clearCustom();
    render();
  });
byId("download").addEventListener("click", () => {
  if (previousRecord) downloadRide(previousRecord);
});
byId("export-data").addEventListener(
  "click",
  () =>
    void act(() => {
      persistRide(true);
      if (!savedToDevice && previousRecord) {
        downloadRide(previousRecord);
        appError =
          "Browser storage could not save the latest ride, so its current CSV download was started instead. The full JSON backup is unavailable until saving works again.";
        return;
      }
      downloadText(
        exportAllData(),
        `open-trainer-backup-${new Date().toISOString().slice(0, 10)}.json`,
        "application/json",
      );
    }),
);
byId("restore-ride").addEventListener("click", () => {
  const checkpoint = recovery;
  if (!checkpoint) return;
  if (trainer?.connection.current !== "ready") {
    void connect(checkpoint.record.simulator, true);
    return;
  }
  const currentRide = ride;
  if (currentRide?.status !== "ready" || currentRide.simulator !== checkpoint.record.simulator) {
    appError = "Disconnect this trainer first, then choose Connect to recover.";
    render();
    return;
  }
  void act(() => {
    currentRide.restore(checkpoint.workout, checkpoint.record, checkpoint.adjustment);
    showRecoveredWorkout();
  });
});
byId("archive-recovery").addEventListener("click", () => {
  if (!recovery || ride?.active) return;
  if (saveRide(recovery.record) && clearCheckpoint()) {
    archivedRideId = recovery.record.startedAt;
    recovery = null;
    historyRecords = listRides();
  } else appError = "Could not update browser storage. Export a backup to keep your data.";
  render();
});
byId("fullscreen").addEventListener(
  "click",
  () =>
    void act(async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    }),
);
byId("lab-link").addEventListener("click", (event) => {
  if (ride?.active) {
    event.preventDefault();
    appError = "End your ride before opening Trainer Lab.";
    render();
  }
});
document.addEventListener("keydown", (event) => {
  const currentRide = ride;
  if (event.key === "Escape" && currentRide?.active) {
    event.preventDefault();
    void act(() => currentRide.finish());
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persistRide(true);
  void keepScreenAwake(ride?.active ?? false);
});
window.addEventListener("pagehide", () => persistRide(true));
window.addEventListener("beforeunload", (event) => {
  if (ride?.active) {
    persistRide(true);
    event.preventDefault();
  }
});
setInterval(() => {
  void ride?.tick().then(render);
  if (!ride) render();
}, 250);
render();
