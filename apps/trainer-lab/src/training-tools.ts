import type { Ride, RideRecord } from "./ride";
import type { RideControlMode, RideOptions } from "./ride-control";
import { supportsMode } from "./ride-control";
import { ROUTES, findRoute, compatibleGhosts, ghostDistance } from "./routes";
import { currentStep, formatTime, type Workout } from "./workout";
import { mountWorkoutEditor } from "./workout-editor";
import { mountSensors } from "./ui/sensors";
import { showAnalysis } from "./ui/ride-analysis";
import { byId } from "./ui/dom";
import {
  SensorManager,
  RideCoach,
  screenAwakeStatus,
  importRideBackup,
  rideStorageInfo,
  BACKUP_BYTE_LIMIT,
  deleteRide,
  downloadBytes,
  rideFit,
  type Trainer,
} from "./services";

interface TrainingTools {
  readonly sensors: SensorManager;
  readonly customWorkout: Workout | undefined;
  readonly options: RideOptions;
  clearCustom(): void;
  analyze: (record: RideRecord) => void;
  exportFit: (record: RideRecord) => void;
  remove: (record: RideRecord) => void;
  update(ride: Ride | undefined, trainer: Trainer | undefined, history: RideRecord[]): void;
  refreshStorage(): void;
}

export function mountTrainingTools(callbacks: {
  run: (operation: () => void | Promise<void>) => Promise<void>;
  runRide: (operation: () => void | Promise<void>) => Promise<void>;
  selectedWorkout: () => Workout;
  refresh: () => void;
  reload: () => void;
}): TrainingTools {
  const sensors = new SensorManager();
  mountSensors(byId("sensor-panel"), sensors);
  const coach = new RideCoach();
  let currentRide: Ride | undefined;
  let records: RideRecord[] = [];
  let custom: Workout | undefined;
  let ghostKey = "";
  const mode = byId("ride-mode", HTMLSelectElement);
  const route = byId("route-select", HTMLSelectElement);
  const ghost = byId("ghost-select", HTMLSelectElement);
  const editor = mountWorkoutEditor(byId("workout-editor"), (workout) => {
    custom = workout;
    byId("custom-workout").textContent = `Selected: ${workout.name}`;
    callbacks.refresh();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  for (const item of ROUTES) route.add(new Option(`${item.name} · ${item.lengthKm} km`, item.id));
  for (const input of [mode, route, ghost]) input.addEventListener("change", callbacks.refresh);
  byId("clear-custom").addEventListener("click", () => {
    custom = undefined;
    byId("custom-workout").textContent = "Choose a favorite or build your own.";
    callbacks.refresh();
  });
  byId("edit-current").addEventListener("click", () => {
    editor.load(currentRide?.workout ?? callbacks.selectedWorkout());
    byId("editor-details", HTMLDetailsElement).open = true;
  });
  byId("skip-interval").addEventListener(
    "click",
    () =>
      void callbacks.runRide(async () => {
        await currentRide?.skipInterval();
      }),
  );
  byId("extend-interval").addEventListener(
    "click",
    () =>
      void callbacks.runRide(() => {
        currentRide?.extendInterval();
      }),
  );
  const sound = byId("audio-cues", HTMLInputElement);
  const speech = byId("spoken-cues", HTMLInputElement);
  for (const checkbox of [sound, speech])
    checkbox.addEventListener(
      "change",
      () =>
        void callbacks.run(async () => {
          sound.disabled = speech.disabled = true;
          try {
            await coach.enable(sound.checked, speech.checked);
          } catch (error) {
            sound.checked = speech.checked = false;
            throw error;
          } finally {
            sound.disabled = speech.disabled = false;
          }
        }),
    );
  byId("import-backup", HTMLInputElement).addEventListener("change", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    void callbacks.run(async () => {
      if (currentRide?.active) throw new Error("End your ride before importing a backup.");
      if (file.size > BACKUP_BYTE_LIMIT)
        throw new Error("Choose a ride backup smaller than 20 MB.");
      const json = await file.text();
      if (currentRide?.active) throw new Error("End your ride before importing a backup.");
      const result = importRideBackup(json);
      byId("data-status").textContent =
        `Merged ${result.imported} rides. ${result.total} saved.${result.recovered ? " An unfinished ride is available to recover." : ""}`;
      callbacks.reload();
    });
  });
  return {
    sensors,
    get customWorkout(): Workout | undefined {
      return custom;
    },
    clearCustom(): void {
      custom = undefined;
      byId("custom-workout").textContent = "Choose a favorite or build your own.";
    },
    get options(): RideOptions {
      return { controlMode: mode.value as RideControlMode, routeId: route.value };
    },
    analyze(record: RideRecord): void {
      showAnalysis(record, records);
    },
    exportFit(record: RideRecord): void {
      void callbacks.run(async () =>
        downloadBytes(
          await rideFit(record),
          `open-trainer-${record.simulator ? "demo-" : ""}${record.startedAt.replaceAll(":", "-")}.fit`,
          "application/octet-stream",
        ),
      );
    },
    remove(record: RideRecord): void {
      void callbacks.run(() => {
        if (currentRide?.active) throw new Error("End your ride before managing history.");
        deleteRide(record.startedAt);
        callbacks.reload();
      });
    },
    update(ride: Ride | undefined, trainer: Trainer | undefined, history: RideRecord[]): void {
      currentRide = ride;
      records = history;
      const busy = ride !== undefined && ride.status !== "ready";
      mode.disabled = route.disabled = busy;
      editor.setBusy(busy);
      byId("clear-custom", HTMLButtonElement).disabled = busy;
      byId("edit-current", HTMLButtonElement).disabled = busy;
      if (ride?.workout) {
        mode.value = ride.controlMode;
        if (ride.routeId) route.value = ride.routeId;
      }
      for (const option of mode.options)
        option.disabled =
          Boolean(trainer?.capabilities.current) &&
          !supportsMode(trainer?.capabilities.current, option.value as RideControlMode);
      byId("mode-help").textContent =
        mode.value === "erg"
          ? "Trainer holds your target power as you pedal. Shift less, find a steady cadence."
          : mode.value === "resistance"
            ? "You control a fixed resistance level. Shift gears and change cadence to find your effort."
            : "Trainer follows the route grade. Shift gears as the road rises. Distance uses trainer speed.";
      const terrain = mode.value === "terrain";
      byId("terrain-setup").hidden = !terrain;
      byId("terrain-progress").hidden = !terrain;
      const selectedRoute = findRoute(route.value);
      if (terrain) renderTerrain(selectedRoute, ride?.distanceKm ?? 0);
      const comparable = compatibleGhosts(
        history,
        selectedRoute.id,
        ride?.simulator ?? false,
      ).filter((record) => record.startedAt !== ride?.startedAt);
      const key = JSON.stringify(comparable.map((record) => [record.startedAt, record.seconds]));
      if (key !== ghostKey) {
        ghostKey = key;
        const chosen = ghost.value;
        ghost.replaceChildren(new Option("Ride solo", ""));
        for (const record of comparable)
          ghost.add(
            new Option(
              `${new Date(record.startedAt).toLocaleDateString()} · ${formatTime(Math.floor(record.seconds))}`,
              record.startedAt,
            ),
          );
        if (comparable.some((record) => record.startedAt === chosen)) ghost.value = chosen;
      }
      const ghostRide = comparable.find((record) => record.startedAt === ghost.value);
      const ghostKm = ghostRide ? ghostDistance(ghostRide, ride?.elapsed ?? 0) : null;
      const lead = (ride?.distanceKm ?? 0) - (ghostKm ?? 0);
      byId("ghost-status").textContent = ghostRide
        ? ghostKm === null
          ? "Ghost has finished its recorded ride."
          : `${Math.abs(lead * 1000).toFixed(0)} m ${lead >= 0 ? "ahead of" : "behind"} your ghost`
        : comparable.length
          ? "Choose a past ride to race your own line."
          : "Complete a terrain ride to unlock a matching ghost.";
      const available =
        ["riding", "paused"].includes(ride?.status ?? "") &&
        !ride?.busy &&
        ride?.workout?.seconds !== null;
      byId("skip-interval", HTMLButtonElement).disabled = !available;
      byId("extend-interval", HTMLButtonElement).disabled = !available;
      const stage = ride?.workout ? currentStep(ride.workout, ride.workoutElapsed) : undefined;
      byId("cadence-cue").textContent = stage?.step.cadenceRpm
        ? `Cadence cue: ${stage.step.cadenceRpm} rpm`
        : "Find a comfortable cadence.";
      const heartRate = ride?.telemetry?.heartRateBpm;
      byId("heart-rate").textContent = `${heartRate ?? "—"} bpm`;
      coach.update(ride);
      const wake = screenAwakeStatus();
      const wakeText = {
        active: "Screen stays awake",
        inactive: "Screen wake lock starts with your ride",
        requesting: "Keeping your screen awake…",
        unavailable: "Wake lock unavailable · check computer sleep settings",
      }[wake];
      byId("wake-status").textContent = wakeText;
      byId("wake-status").dataset.active = String(wake === "active");
      byId("import-backup", HTMLInputElement).disabled = Boolean(ride?.active);
    },
    refreshStorage(): void {
      try {
        const info = rideStorageInfo();
        byId("storage-detail").textContent =
          `${info.rides} / ${info.limit} rides · ${(info.bytes / 1_000_000).toFixed(2)} MB · ${info.samples.toLocaleString()} samples. Back up regularly; browser storage has a limited quota.`;
      } catch {
        byId("storage-detail").textContent =
          "Browser storage is unavailable. Download your ride to keep it.";
      }
    },
  };
}

function renderTerrain(route: ReturnType<typeof findRoute>, distance: number): void {
  byId("route-title").textContent = route.name;
  byId("route-distance").textContent =
    `${(distance % route.lengthKm).toFixed(2)} / ${route.lengthKm} km · lap ${Math.floor(distance / route.lengthKm) + 1}`;
  const chart = byId("route-profile");
  if (chart.dataset.route !== route.id) {
    chart.dataset.route = route.id;
    chart.replaceChildren();
    for (const grade of route.grades) {
      const bar = document.createElement("span");
      bar.style.height = `${25 + (grade + 5) * 5}%`;
      bar.title = `${grade}% grade`;
      chart.append(bar);
    }
    const marker = document.createElement("i");
    marker.className = "route-marker";
    chart.append(marker);
  }
  const marker = chart.querySelector<HTMLElement>(".route-marker");
  if (marker) marker.style.left = `${(100 * (distance % route.lengthKm)) / route.lengthKm}%`;
}
