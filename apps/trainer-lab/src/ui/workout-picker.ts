import { WORKOUT_OPTIONS } from "../workout";

const icons: Record<string, string> = {
  sun: "≋",
  zap: "ϟ",
  leaf: "◌",
  wind: "≈",
  activity: "⌁",
  mountain: "△",
  infinity: "∞",
};

export function mountWorkoutPicker(fieldset: HTMLFieldSetElement): void {
  for (const option of WORKOUT_OPTIONS) {
    const label = document.createElement("label");
    label.className = "workout-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "workout";
    input.value = option.id;
    input.checked = option.id === "endurance";
    const icon = document.createElement("span");
    icon.className = "option-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = icons[option.icon] ?? "↗";
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = option.name;
    const description = document.createElement("small");
    description.textContent = option.description;
    copy.append(title, description);
    const mark = document.createElement("span");
    mark.className = "radio-mark";
    mark.setAttribute("aria-hidden", "true");
    label.append(input, icon, copy, mark);
    fieldset.append(label);
  }
}
