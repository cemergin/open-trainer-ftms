import type { SensorKind, SensorManager, SensorMetric, TelemetrySource } from "../services";

const SENSORS: { kind: SensorKind; metric: SensorMetric; label: string; unit: string }[] = [
  { kind: "power", metric: "power", label: "Power", unit: "W" },
  { kind: "cadence", metric: "cadence", label: "Cadence", unit: "rpm" },
  { kind: "heart-rate", metric: "heartRate", label: "Heart rate", unit: "bpm" },
];

/** Pairing and source changes only run in response to explicit button/select gestures. */
export function mountSensors(container: HTMLElement, manager: SensorManager): () => void {
  const heading = document.createElement("h3");
  heading.textContent = "Optional sensors";
  const description = document.createElement("p");
  description.textContent =
    "Pair a Bluetooth sensor or try a demo, then choose its data source. A missing external signal stays missing until you change the source. Demo sensors can only be used with a demo trainer.";
  container.replaceChildren(heading, description);
  const cleanups: (() => void)[] = [];
  for (const { kind, metric, label, unit } of SENSORS) {
    const row = document.createElement("div");
    row.className = "sensor-row";
    const title = document.createElement("strong");
    title.textContent = label;
    const sourceLabel = document.createElement("label");
    sourceLabel.textContent = `${label} source `;
    const select = document.createElement("select");
    for (const [value, text] of [
      ["trainer", "Trainer"],
      ["external", "External sensor"],
      ["none", "Off"],
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    select.value = manager.state.current.sources[metric];
    select.addEventListener("change", () =>
      manager.selectSource(metric, select.value as TelemetrySource),
    );
    sourceLabel.append(select);
    const status = document.createElement("span");
    status.className = "sensor-status";
    const error = document.createElement("span");
    error.setAttribute("role", "status");
    const pair = document.createElement("button");
    pair.type = "button";
    pair.textContent = `Pair ${label.toLowerCase()}`;
    const demo = document.createElement("button");
    demo.type = "button";
    demo.textContent = "Demo";
    demo.setAttribute("aria-label", `Use demo ${label.toLowerCase()} sensor`);
    const disconnect = document.createElement("button");
    disconnect.type = "button";
    disconnect.textContent = "Disconnect";
    disconnect.setAttribute("aria-label", `Disconnect ${label.toLowerCase()} sensor`);
    const connect = (simulator: boolean): void => {
      error.textContent = "";
      try {
        void manager.connect(kind, simulator).catch((reason: unknown) => {
          error.textContent = reason instanceof Error ? reason.message : "Sensor pairing failed.";
        });
      } catch (reason) {
        error.textContent = reason instanceof Error ? reason.message : "Sensor pairing failed.";
      }
    };
    pair.addEventListener("click", () => connect(false));
    demo.addEventListener("click", () => connect(true));
    disconnect.addEventListener("click", () => {
      void manager.disconnect(kind).catch((reason: unknown) => {
        error.textContent = reason instanceof Error ? reason.message : "Sensor disconnect failed.";
      });
    });
    cleanups.push(
      manager.state.subscribe((state) => {
        const sensor = state.sensors[kind];
        select.value = state.sources[metric];
        const busy = sensor?.state.status === "connecting" || sensor?.state.status === "connected";
        pair.disabled = Boolean(busy || sensor?.simulator);
        demo.disabled = Boolean(busy || (sensor && !sensor.simulator));
        disconnect.disabled = !sensor;
        const value =
          sensor?.telemetry.fresh && sensor.telemetry.value !== null
            ? `${Math.round(sensor.telemetry.value)} ${unit}`
            : "No fresh reading";
        const battery = sensor?.telemetry.batteryPercent;
        status.textContent = sensor
          ? `${sensor.simulator ? "Demo" : "Bluetooth"} · ${sensor.state.name ?? label}: ${sensor.state.status} · ${value}${battery !== null && battery !== undefined ? ` · ${battery}% battery` : ""}`
          : "No sensor paired";
      }),
    );
    row.append(title, sourceLabel, pair, demo, disconnect, status, error);
    container.append(row);
  }
  return () => {
    for (const cleanup of cleanups) cleanup();
    container.replaceChildren();
  };
}
