import {
  downloadText,
  exportWorkoutJson,
  loadWorkoutProfiles,
  parseWorkoutJson,
  removeWorkoutProfile,
  saveWorkoutProfile,
  WORKOUT_JSON_LIMIT,
} from "./services";
import { createWorkout, formatTime, type Workout, type WorkoutStep } from "./workout";
import { profileFromWorkout, workoutFromProfile, type WorkoutBlock } from "./workout-profile";
import "./workout-editor.css";

export interface WorkoutEditor {
  setBusy(busy: boolean): void;
  load(workout: Workout): void;
  dispose(): void;
}

export function mountWorkoutEditor(
  container: HTMLElement,
  onSelect: (workout: Workout) => void,
): WorkoutEditor {
  return new EditorView(container, onSelect);
}

class EditorView implements WorkoutEditor {
  private profile = profileFromWorkout(createWorkout("endurance", 20, 100), "draft");
  private busy = false;
  private disposed = false;
  private readonly fieldset = element("fieldset", "workout-editor");
  private readonly blocks = element("div", "editor-blocks");
  private readonly preview = element("div", "editor-preview");
  private readonly saved = element("select");
  private readonly status = element("p", "editor-status");
  private readonly name = element("input");

  constructor(
    private readonly container: HTMLElement,
    private readonly onSelect: (workout: Workout) => void,
  ) {
    this.fieldset.append(element("legend", "", "Workout builder"));
    this.name.type = "text";
    this.name.maxLength = 100;
    this.name.addEventListener("input", () => {
      this.profile.name = this.name.value;
      this.renderPreview();
    });
    this.fieldset.append(label("Workout name", this.name));
    const favorites = element("div", "editor-toolbar");
    favorites.append(
      label("Saved workouts", this.saved),
      button("Load", () => this.act(() => this.loadFavorite())),
      button("Remove saved", () =>
        this.act(() => {
          if (!this.saved.value) throw new Error("Choose a saved workout first.");
          removeWorkoutProfile(this.saved.value);
          this.refreshFavorites();
          this.announce("Saved workout removed.");
        }),
      ),
    );
    this.fieldset.append(favorites, this.preview, this.blocks);
    const add = element("div", "editor-toolbar");
    add.append(
      button("+ Steady block", () => this.addBlock([newStep()])),
      button("+ Ramp", () => this.addBlock([{ ...newStep("Ramp"), watts: 75, endWatts: 150 }])),
      button("+ Repeated pair", () =>
        this.addBlock(
          [
            { ...newStep("Effort"), watts: 150, effort: "hard" },
            { ...newStep("Recovery"), watts: 75, effort: "easy" },
          ],
          3,
        ),
      ),
    );
    const actions = element("div", "editor-toolbar");
    actions.append(
      button(
        "Use this workout",
        () =>
          this.act(() => {
            this.onSelect(workoutFromProfile(this.profile));
            this.announce(`${this.profile.name} is selected for your next ride.`);
          }),
        "primary",
      ),
      button("Save favorite", () =>
        this.act(() => {
          const profile = {
            ...this.profile,
            id: this.profile.id === "draft" ? crypto.randomUUID() : this.profile.id,
          };
          saveWorkoutProfile(profile);
          this.profile = profile;
          this.refreshFavorites();
          this.saved.value = profile.id;
          this.announce("Workout saved on this device.");
        }),
      ),
      button("Export JSON", () =>
        this.act(() => {
          downloadText(
            exportWorkoutJson(this.profile),
            "open-trainer-workout.json",
            "application/json",
          );
          this.announce("Workout JSON downloaded.");
        }),
      ),
    );
    const file = element("input");
    file.type = "file";
    file.accept = ".json,application/json";
    file.addEventListener("change", () => {
      void this.importFile(file);
    });
    actions.append(label("Import workout JSON", file));
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.fieldset.append(add, actions, this.status);
    this.container.replaceChildren(this.fieldset);
    this.render();
    this.act(() => this.refreshFavorites());
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.fieldset.disabled = busy;
  }

  load(workout: Workout): void {
    if (this.busy) return;
    this.act(() => {
      this.profile = profileFromWorkout(workout);
      this.render();
      this.announce("Workout loaded into the editor.");
    });
  }

  dispose(): void {
    this.disposed = true;
    this.container.replaceChildren();
  }

  private async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file || this.busy) return;
    try {
      if (file.size > WORKOUT_JSON_LIMIT)
        throw new Error("Workout files must be smaller than 256 KB.");
      const profile = parseWorkoutJson(await file.text());
      if (this.unavailable()) return;
      this.profile = { ...profile, id: "draft" };
      this.render();
      this.announce("Workout imported. Choose Use this workout when ready.");
    } catch (error) {
      if (!this.disposed) this.announce(errorMessage(error), true);
    } finally {
      input.value = "";
    }
  }

  private loadFavorite(): void {
    const profile = loadWorkoutProfiles().find((item) => item.id === this.saved.value);
    if (!profile) throw new Error("Choose a saved workout first.");
    this.profile = profile;
    this.render();
    this.announce("Saved workout loaded. Choose Use this workout when ready.");
  }

  private refreshFavorites(): void {
    this.saved.replaceChildren(
      new Option("Choose a workout", ""),
      ...loadWorkoutProfiles().map((profile) => new Option(profile.name, profile.id)),
    );
  }

  private addBlock(steps: WorkoutStep[], repeat = 1): void {
    this.profile.blocks.push({ repeat, steps });
    this.render();
  }

  private render(): void {
    this.name.value = this.profile.name;
    this.blocks.replaceChildren(
      ...this.profile.blocks.map((block, index) => this.renderBlock(block, index)),
    );
    this.renderPreview();
  }

  private renderBlock(block: WorkoutBlock, index: number): HTMLElement {
    const card = element("section", "editor-block");
    const heading = element("div", "editor-block-heading");
    const move = (offset: number): void => {
      const target = index + offset;
      if (target < 0 || target >= this.profile.blocks.length) return;
      this.profile.blocks.splice(index, 1);
      this.profile.blocks.splice(target, 0, block);
      this.render();
    };
    const up = button("↑", () => move(-1));
    up.setAttribute("aria-label", `Move block ${index + 1} earlier`);
    up.disabled = index === 0;
    const down = button("↓", () => move(1));
    down.setAttribute("aria-label", `Move block ${index + 1} later`);
    down.disabled = index === this.profile.blocks.length - 1;
    heading.append(
      element("strong", "", `Block ${index + 1}`),
      numericInput("Repeats", block.repeat, 1, 20, (value) => {
        block.repeat = value;
        this.renderPreview();
      }),
      up,
      down,
      button("Remove block", () => {
        this.profile.blocks.splice(index, 1);
        this.render();
      }),
    );
    card.append(heading);
    for (const [stepIndex, step] of block.steps.entries()) {
      const row = element("div", "editor-step");
      const title = element("input");
      title.type = "text";
      title.maxLength = 100;
      title.value = step.name;
      title.addEventListener("input", () => {
        step.name = title.value;
        this.renderPreview();
      });
      row.append(
        label("Step name", title),
        numericInput("Seconds", step.seconds, 1, 86400, (value) => {
          step.seconds = value;
          this.renderPreview();
        }),
        numericInput("Start W", step.watts, 0, 600, (value) => {
          step.watts = value;
          this.renderPreview();
        }),
        optionalInput("End W (ramp)", step.endWatts, 0, 600, (value) => {
          if (value === undefined) delete step.endWatts;
          else step.endWatts = value;
          this.renderPreview();
        }),
        optionalInput("Cadence rpm", step.cadenceRpm, 1, 250, (value) => {
          if (value === undefined) delete step.cadenceRpm;
          else step.cadenceRpm = value;
          this.renderPreview();
        }),
        button("Remove step", () => {
          block.steps.splice(stepIndex, 1);
          this.render();
        }),
      );
      card.append(row);
    }
    card.append(
      button("+ Step in block", () => {
        block.steps.push(newStep());
        this.render();
      }),
    );
    return card;
  }

  private renderPreview(): void {
    try {
      const workout = workoutFromProfile(this.profile);
      this.preview.replaceChildren(
        profileChart(workout),
        element(
          "p",
          "",
          `${formatTime(workout.seconds ?? 0)} · ${workout.steps.length} steps · ERG power targets`,
        ),
      );
    } catch (error) {
      this.preview.replaceChildren(element("p", "editor-error", errorMessage(error)));
    }
  }

  private act(action: () => void): void {
    if (this.unavailable()) return;
    try {
      action();
    } catch (error) {
      this.announce(errorMessage(error), true);
    }
  }

  private unavailable(): boolean {
    return this.busy || this.disposed;
  }

  private announce(message: string, error = false): void {
    this.status.textContent = message;
    this.status.classList.toggle("editor-error", error);
  }
}

function newStep(name = "Steady"): WorkoutStep {
  return { name, seconds: 120, watts: 100, effort: "steady" };
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function label(text: string, input: HTMLElement): HTMLLabelElement {
  const node = element("label", "editor-field");
  node.append(element("span", "", text), input);
  return node;
}

function button(text: string, onClick: () => void, className = ""): HTMLButtonElement {
  const node = element("button", className, text);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function numericInput(
  text: string,
  value: number,
  min: number,
  max: number,
  onChange: (value: number) => void,
): HTMLLabelElement {
  return optionalInput(text, value, min, max, (next) => onChange(next ?? NaN));
}

function optionalInput(
  text: string,
  value: number | undefined,
  min: number,
  max: number,
  onChange: (value: number | undefined) => void,
): HTMLLabelElement {
  const input = element("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = "1";
  input.value = value === undefined ? "" : String(value);
  input.placeholder = "Optional";
  input.addEventListener("input", () =>
    onChange(input.value === "" ? undefined : input.valueAsNumber),
  );
  return label(text, input);
}

function profileChart(workout: Workout): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 600 100");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${workout.name}, power profile`);
  const maximum = Math.max(
    100,
    ...workout.steps.flatMap((step) => [step.watts, step.endWatts ?? step.watts]),
  );
  let x = 0;
  for (const step of workout.steps) {
    const end = x + (step.seconds / (workout.seconds ?? 1)) * 600;
    const shape = document.createElementNS(ns, "polygon");
    shape.setAttribute(
      "points",
      `${x},100 ${x},${95 - (step.watts / maximum) * 85} ${end},${95 - ((step.endWatts ?? step.watts) / maximum) * 85} ${end},100`,
    );
    const title = document.createElementNS(ns, "title");
    title.textContent = `${step.name}: ${step.watts}${step.endWatts === undefined ? "" : ` → ${step.endWatts}`} W, ${formatTime(step.seconds)}`;
    shape.append(title);
    svg.append(shape);
    x = end;
  }
  return svg;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
