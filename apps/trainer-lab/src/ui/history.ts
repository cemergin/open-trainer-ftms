import type { RideRecord } from "../ride";
import { formatTime } from "../workout";

export function renderRideHistory(
  container: HTMLElement,
  records: RideRecord[],
  download: (record: RideRecord) => void,
  actions?: {
    analyze: (record: RideRecord) => void;
    exportFit: (record: RideRecord) => void;
    remove: (record: RideRecord) => void;
  },
): void {
  container.replaceChildren();
  if (!records.length) {
    const empty = document.createElement("p");
    empty.className = "history-note";
    empty.textContent = "Your first ride starts the collection. Every minute counts.";
    container.append(empty);
    return;
  }
  for (const record of records) {
    const row = document.createElement("article");
    row.className = "history-row";
    const name = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${record.simulator ? "Demo · " : ""}${record.name}`;
    const date = document.createElement("small");
    date.textContent = new Date(record.startedAt).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    name.append(title, date);
    const duration = document.createElement("span");
    duration.className = "history-metric";
    duration.textContent = formatTime(Math.floor(record.seconds));
    const status = document.createElement("small");
    status.textContent = record.completed ? "Workout complete" : "Partial ride";
    duration.append(status);
    const power = document.createElement("span");
    power.className = "history-metric";
    power.textContent = `${record.averagePower ?? "—"} W avg`;
    const distance = document.createElement("small");
    distance.textContent = `${record.distanceKm.toFixed(2)} km`;
    power.append(distance);
    const button = document.createElement("button");
    button.className = "button subtle";
    button.textContent = "CSV ↓";
    button.setAttribute("aria-label", `Download ${record.name} from ${date.textContent}`);
    button.addEventListener("click", () => download(record));
    const buttons = document.createElement("div");
    buttons.className = "history-actions";
    buttons.append(button);
    if (actions) {
      for (const [label, action] of [
        ["Analyze", actions.analyze],
        ["FIT ↓", actions.exportFit],
      ] as const) {
        const control = document.createElement("button");
        control.className = "button subtle";
        control.textContent = label;
        control.addEventListener("click", () => action(record));
        buttons.append(control);
      }
      const remove = document.createElement("button");
      remove.className = "button subtle";
      remove.textContent = "Delete";
      let confirmUntil = 0;
      remove.addEventListener("click", () => {
        if (Date.now() < confirmUntil) actions.remove(record);
        else {
          confirmUntil = Date.now() + 5000;
          remove.textContent = "Confirm delete";
          setTimeout(() => {
            remove.textContent = "Delete";
          }, 5000);
        }
      });
      buttons.append(remove);
    }
    row.append(name, duration, power, buttons);
    container.append(row);
  }
}
