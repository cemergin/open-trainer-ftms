import { analyzeRide } from "../analysis";
import type { RideRecord } from "../ride";
import { formatTime } from "../workout";
import { byId } from "./dom";
const NS = "http://www.w3.org/2000/svg";
export function showAnalysis(record: RideRecord, records: RideRecord[]): void {
  const panel = byId("analysis-panel", HTMLDetailsElement);
  const select = byId("compare-ride", HTMLSelectElement);
  select.replaceChildren(new Option("No comparison", ""));
  for (const other of records) {
    if (other.startedAt === record.startedAt || other.simulator !== record.simulator) continue;
    select.add(
      new Option(
        `${other.name} · ${new Date(other.startedAt).toLocaleDateString()}`,
        other.startedAt,
      ),
    );
  }
  const render = (): void =>
    renderAnalysis(
      record,
      records.find((other) => other.startedAt === select.value),
    );
  select.onchange = render;
  byId("analysis-ftp", HTMLInputElement).oninput = render;
  panel.open = true;
  render();
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}
function renderAnalysis(record: RideRecord, compare?: RideRecord): void {
  byId("analysis-title").textContent = `${record.simulator ? "Demo · " : ""}${record.name}`;
  const ftp = byId("analysis-ftp", HTMLInputElement);
  if (!ftp.checkValidity() || !ftp.value) return;
  const analysis = analyzeRide(record, ftp.valueAsNumber);
  const metrics = byId("analysis-metrics");
  metrics.replaceChildren();
  const values = [
    ["Measured power", formatTime(Math.floor(analysis.measuredSeconds))],
    [
      "In the pocket",
      analysis.targetSeconds
        ? `${Math.round((100 * analysis.onTargetSeconds) / analysis.targetSeconds)}%`
        : "—",
    ],
    ["Target error", analysis.targetError !== null ? `${Math.round(analysis.targetError)} W` : "—"],
    [
      "Cadence spread",
      analysis.cadenceDeviation !== null ? `±${Math.round(analysis.cadenceDeviation)} rpm` : "—",
    ],
    ["Peak power", analysis.peakPower !== null ? `${Math.round(analysis.peakPower)} W` : "—"],
  ];
  for (const [label, value] of values) {
    const item = document.createElement("div");
    const title = document.createElement("small");
    const number = document.createElement("strong");
    title.textContent = label ?? "";
    number.textContent = value ?? "";
    item.append(title, number);
    metrics.append(item);
  }
  const zones = byId("analysis-zones");
  zones.replaceChildren();
  analysis.zones.forEach((seconds, index) => {
    const row = document.createElement("div");
    row.className = "zone-row";
    const label = document.createElement("span");
    label.textContent = `Z${index + 1}`;
    const track = document.createElement("div");
    track.className = "zone-track";
    const bar = document.createElement("i");
    bar.style.width = `${(100 * seconds) / Math.max(1, analysis.measuredSeconds)}%`;
    bar.dataset.zone = String(index + 1);
    track.append(bar);
    const value = document.createElement("span");
    value.textContent = formatTime(Math.floor(seconds));
    row.append(label, track, value);
    zones.append(row);
  });
  drawChart(record, compare);
  byId("analysis-note").textContent =
    `${record.samples.length} samples · gaps stay empty · ${record.controlMode ?? "erg"} mode. Zones use the reference FTP above; 200 W is a placeholder, not a measured FTP.${compare ? ` Comparison: ${compare.name}, ${compare.averagePower ?? "—"} W average vs ${record.averagePower ?? "—"} W, ${formatTime(Math.floor(compare.seconds))} vs ${formatTime(Math.floor(record.seconds))}.` : ""}`;
}
function drawChart(record: RideRecord, compare?: RideRecord): void {
  const container = byId("analysis-chart");
  container.replaceChildren();
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 800 200");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    "Power over elapsed ride time: green actual, grey target, blue comparison. Gaps represent missing data.",
  );
  let maximum = 100;
  for (const item of [record, compare])
    for (const sample of item?.samples ?? [])
      maximum = Math.max(maximum, sample.watts ?? 0, sample.target);
  const duration = Math.max(1, record.seconds, compare?.seconds ?? 0);
  const add = (item: RideRecord, target: boolean, color: string): void => {
    let path = "",
      previous = -Infinity;
    for (const sample of item.samples) {
      const watts = target ? sample.target : sample.watts;
      if (watts === null) {
        previous = -Infinity;
        continue;
      }
      path += `${sample.seconds - previous <= 5 ? "L" : "M"}${((sample.seconds / duration) * 800).toFixed(1)},${(190 - (Math.max(0, watts) / maximum) * 175).toFixed(1)} `;
      previous = sample.seconds;
    }
    const line = document.createElementNS(NS, "path");
    line.setAttribute("d", path);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "2");
    svg.append(line);
  };
  if ((record.controlMode ?? "erg") === "erg") add(record, true, "var(--color-text-muted)");
  if (compare) add(compare, false, "var(--color-power-below)");
  add(record, false, "var(--color-accent)");
  container.append(svg);
}
