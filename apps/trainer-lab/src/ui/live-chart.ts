import type { RideSample, RideStatus } from "../ride";
import type { RideControlMode } from "../ride-control";
import { formatTime } from "../workout";
import { byId } from "./dom";

const WINDOW_SECONDS = 120;
const WIDTH = 600;
const TOP = 4;
const HEIGHT = 132;

interface LiveChartData {
  start: number;
  end: number;
  powerMax: number;
  heartRateMax: number;
  power: string;
  heartRate: string;
  target: string;
  latestPower: number | null;
  latestHeartRate: number | null;
}

/** Use recorded active time so pauses freeze the chart and recovery restores its history. */
export function liveChartData(
  samples: readonly RideSample[],
  elapsed: number,
  mode: RideControlMode,
): LiveChartData {
  const end = Math.max(WINDOW_SECONDS, elapsed);
  const start = end - WINDOW_SECONDS;
  let first = samples.length;
  while (first > 0 && (samples[first - 1]?.seconds ?? -Infinity) >= start) first--;
  const recent = samples.slice(first).filter((sample) => sample.seconds <= elapsed);
  const erg = mode === "erg";
  let powerMax = 200;
  let heartRateMax = 200;
  for (const sample of recent) {
    powerMax = Math.max(powerMax, sample.watts ?? 0, erg ? sample.target : 0);
    heartRateMax = Math.max(heartRateMax, sample.heartRate ?? 0);
  }
  powerMax = Math.ceil(powerMax / 100) * 100;
  heartRateMax = Math.ceil(heartRateMax / 20) * 20;
  const last = recent.at(-1);
  const fresh = last && elapsed - last.seconds <= 5;
  return {
    start,
    end,
    powerMax,
    heartRateMax,
    power: linePath(recent, "watts", start, powerMax),
    heartRate: linePath(recent, "heartRate", start, heartRateMax),
    target: erg ? linePath(recent, "target", start, powerMax) : "",
    latestPower: fresh ? (last.watts ?? null) : null,
    latestHeartRate: fresh ? (last.heartRate ?? null) : null,
  };
}

function linePath(
  samples: readonly RideSample[],
  metric: "watts" | "heartRate" | "target",
  start: number,
  maximum: number,
): string {
  let path = "";
  let previous = -Infinity;
  for (const sample of samples) {
    const value = sample[metric];
    if (value === null || value === undefined) {
      previous = -Infinity;
      continue;
    }
    const x = (((sample.seconds - start) / WINDOW_SECONDS) * WIDTH).toFixed(1);
    const y = (TOP + HEIGHT * (1 - Math.max(0, value) / maximum)).toFixed(1);
    const connected = sample.seconds > previous && sample.seconds - previous <= 5;
    // A zero-length segment makes a single sample visible with round line caps.
    path += `${connected ? "L" : "M"}${x},${y}${connected ? "" : `L${x},${y}`} `;
    previous = sample.seconds;
  }
  return path.trim();
}

export function renderLiveChart(
  samples: readonly RideSample[],
  elapsed: number,
  mode: RideControlMode,
  status: RideStatus,
): void {
  const chart = liveChartData(samples, elapsed, mode);
  for (const metric of ["power", "heartRate", "target"] as const)
    byId(`live-chart-${metric}`, SVGElement).setAttribute("d", chart[metric]);
  byId("live-chart-power-scale").textContent = `${chart.powerMax} W`;
  byId("live-chart-heart-scale").textContent = `${chart.heartRateMax} bpm`;
  byId("live-chart-start").textContent = formatTime(Math.floor(chart.start));
  byId("live-chart-end").textContent = formatTime(Math.floor(chart.end));
  const power = chart.latestPower === null ? "— W" : `${Math.round(chart.latestPower)} W`;
  const heartRate =
    chart.latestHeartRate === null ? "— bpm" : `${Math.round(chart.latestHeartRate)} bpm`;
  byId("live-chart-power-value").textContent = power;
  byId("live-chart-heart-value").textContent = heartRate;
  byId("live-chart-target-key").hidden = mode !== "erg";
  byId("live-chart-heart-help").hidden = chart.latestHeartRate !== null;
  byId("live-chart", SVGElement).setAttribute(
    "aria-label",
    `Recorded power and heart rate from ${formatTime(Math.floor(chart.start))} to ${formatTime(Math.floor(chart.end))} of active ride time. Latest sample: ${power}, ${heartRate}. Power uses the left scale; heart rate uses the right. Missing readings leave gaps.${mode === "erg" ? " Dashed line: ERG power target." : ""}`,
  );
  byId("live-chart-note").textContent = {
    ready: "Start a ride to see your effort take shape.",
    starting: "Waiting for your first ride sample…",
    riding: "Active ride time · pauses excluded · missing data leaves gaps",
    paused: "Paused · chart held until you resume",
    stopping: "Ending ride · keeping your recorded effort",
    finished: "Session ended · your final recorded effort",
    interrupted: "Connection interrupted · recorded effort kept",
  }[status];
}
