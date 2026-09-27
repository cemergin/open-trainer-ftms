import type { Trainer, TrainerTelemetry, Unsubscribe } from "./services";
import { currentStep, trainerWatts, type Workout } from "./workout";

export type RideStatus =
  "ready" | "starting" | "riding" | "paused" | "stopping" | "finished" | "interrupted";
export interface RideSample {
  seconds: number;
  watts: number | null;
  cadence: number | null;
  speed: number | null;
  target: number;
}
export interface RideRecord {
  version: 1;
  startedAt: string;
  name: string;
  simulator: boolean;
  seconds: number;
  distanceKm: number;
  averagePower: number | null;
  workKj: number;
  measuredSeconds?: number;
  completed: boolean;
  samples: RideSample[];
}

export class Ride {
  status: RideStatus = "ready";
  workout: Workout | undefined;
  elapsed = 0;
  target = 0;
  adjustment = 0;
  error = "";
  distanceKm = 0;
  workKj = 0;
  readonly samples: RideSample[] = [];
  startedAt = "";
  #measuredSeconds = 0;
  #lastTick = 0;
  #lastTelemetry = -Infinity;
  #lastSample = -1;
  #lowCadenceSince: number | undefined;
  #resumedAt = 0;
  #suspensionDetected = false;
  #epoch = 0;
  #pending: Promise<void> | undefined;
  readonly #subscriptions: Unsubscribe[];

  constructor(
    readonly trainer: Trainer,
    readonly simulator: boolean,
    private readonly now = () => Date.now(),
  ) {
    this.#subscriptions = [
      trainer.telemetry.subscribe((value) => {
        if (value) this.#lastTelemetry = this.now();
      }),
      trainer.connection.subscribe((state) => {
        if (state !== "ready" && this.active)
          this.#interrupt(
            "Trainer disconnected. Reconnect to begin a new ride. Resistance release could not be confirmed.",
          );
      }),
      trainer.control.subscribe((state) => {
        if (state === "revoked" && this.active)
          this.#interrupt("Trainer control was lost. Close other trainer apps and reconnect.");
      }),
    ];
  }

  get busy(): boolean {
    return this.#pending !== undefined;
  }
  get active(): boolean {
    return ["starting", "riding", "paused", "stopping"].includes(this.status);
  }
  get averagePower(): number | null {
    return this.#measuredSeconds > 0
      ? Math.round((this.workKj * 1000) / this.#measuredSeconds)
      : null;
  }
  get telemetry(): TrainerTelemetry | null {
    return this.now() - this.#lastTelemetry <= 5000 ? this.trainer.telemetry.current : null;
  }

  restore(workout: Workout, record: RideRecord, adjustment = 0): void {
    if (this.status !== "ready" || this.busy)
      throw new Error("Only a new ride can restore a checkpoint.");
    const measuredSeconds = checkpointMeasuredSeconds(workout, record, this.simulator, adjustment);
    const target = trainerWatts(
      currentStep(workout, record.seconds).step.watts + adjustment,
      this.trainer.capabilities.current?.powerRange,
    );
    this.workout = workout;
    this.startedAt = record.startedAt;
    this.elapsed = record.seconds;
    this.distanceKm = record.distanceKm;
    this.workKj = record.workKj;
    this.#measuredSeconds = measuredSeconds;
    this.samples.push(...record.samples.map((sample) => ({ ...sample })));
    this.#lastSample = Math.floor(this.samples.at(-1)?.seconds ?? -1);
    this.adjustment = adjustment;
    this.target = target;
    this.status = "paused";
    this.error = "Ride recovered and paused. Resume when you are ready to pedal.";
  }

  async start(workout: Workout): Promise<void> {
    if (this.status !== "ready" || this.busy) return;
    if (!this.trainer.capabilities.current?.supportsPowerTarget) {
      this.error =
        "This trainer does not support ERG power control. Open Trainer Lab for its available controls.";
      return;
    }
    this.workout = workout;
    this.startedAt = new Date().toISOString();
    this.status = "starting";
    await this.#operate(async (epoch) => {
      await this.trainer.acquireControl();
      if (epoch !== this.#epoch) return;
      await this.#sendTarget(epoch);
      if (epoch !== this.#epoch) return;
      await this.trainer.start();
      if (epoch !== this.#epoch) return;
      this.#resumeClock();
    });
  }

  async resume(): Promise<void> {
    if (this.status !== "paused" || this.busy) return;
    this.status = "starting";
    await this.#operate(async (epoch) => {
      if (this.trainer.control.current !== "owned") await this.trainer.acquireControl();
      if (epoch !== this.#epoch) return;
      await this.#sendTarget(epoch);
      if (epoch !== this.#epoch) return;
      await this.trainer.start();
      if (epoch === this.#epoch) this.#resumeClock();
    });
  }

  async pause(reason = ""): Promise<void> {
    if (this.status !== "riding" || this.busy) return;
    this.status = "paused";
    await this.#operate(async (epoch) => {
      await this.trainer.pause();
      if (epoch === this.#epoch) this.error = reason;
    });
  }

  async finish(): Promise<void> {
    if (!this.active || this.status === "stopping") return;
    const epoch = ++this.#epoch;
    this.status = "stopping";
    await this.#pending;
    if (epoch !== this.#epoch) return;
    try {
      if (this.trainer.control.current !== "owned") await this.trainer.acquireControl();
      if (epoch !== this.#epoch) return;
      await this.#stopHardware();
      if (epoch === this.#epoch) this.status = "finished";
    } catch (error) {
      if (epoch === this.#epoch)
        this.#interrupt(
          `Ride ended, but resistance release was not confirmed. ${message(error)} Reconnect before riding again.`,
        );
    }
  }

  async adjust(watts: number): Promise<void> {
    if (!this.workout || !["riding", "paused"].includes(this.status) || this.busy) return;
    const base = currentStep(this.workout, this.elapsed).step.watts;
    const range = this.trainer.capabilities.current?.powerRange;
    const change = Math.sign(watts) * Math.max(Math.abs(watts), range?.increment ?? 1);
    this.adjustment = trainerWatts(this.target + change, range) - base;
    if (this.status === "paused") {
      this.target = this.#desiredTarget();
      return;
    }
    await this.#operate((epoch) => this.#sendTarget(epoch));
  }

  async tick(): Promise<void> {
    if (this.status !== "riding" || !this.workout) return;
    const now = this.now();
    const delta = Math.max(0, (now - this.#lastTick) / 1000);
    this.#lastTick = now;
    if (delta > 5) this.#suspensionDetected = true;
    if (this.#suspensionDetected) {
      await this.pause(
        "Ride paused because the browser or computer went to sleep. Resume when ready.",
      );
      return;
    }
    if (now - this.#resumedAt > 6000 && !this.telemetry) {
      await this.pause(
        "No fresh trainer data. Ride paused; check the Bluetooth connection before resuming.",
      );
      return;
    }
    const cadence = this.telemetry?.instantaneousCadenceRpm;
    if (cadence !== undefined && cadence < 20 && now - this.#resumedAt > 10000) {
      this.#lowCadenceSince ??= now;
      if (now - this.#lowCadenceSince >= 4000) {
        await this.pause("Pedaling stopped. Ride paused; start pedaling before you resume.");
        return;
      }
    } else this.#lowCadenceSince = undefined;

    const seconds = Math.min(delta, (this.workout.seconds ?? Infinity) - this.elapsed);
    this.elapsed += seconds;
    this.#record(seconds);
    if (this.workout.seconds !== null && this.elapsed >= this.workout.seconds) {
      await this.finish();
    } else if (!this.busy && this.#desiredTarget() !== this.target) {
      await this.#operate((epoch) => this.#sendTarget(epoch));
    }
  }

  record(): RideRecord {
    return {
      version: 1,
      startedAt: this.startedAt,
      name: this.workout?.name ?? "Ride",
      simulator: this.simulator,
      seconds: this.elapsed,
      distanceKm: this.distanceKm,
      averagePower: this.averagePower,
      workKj: this.workKj,
      measuredSeconds: this.#measuredSeconds,
      completed:
        this.status === "finished" &&
        this.workout?.seconds !== null &&
        this.elapsed >= (this.workout?.seconds ?? Infinity),
      samples: [...this.samples],
    };
  }

  dispose(): void {
    for (const unsubscribe of this.#subscriptions) unsubscribe();
  }

  #resumeClock(): void {
    this.#lastTick = this.#resumedAt = this.now();
    this.#suspensionDetected = false;
    this.#lowCadenceSince = undefined;
    this.status = "riding";
    this.error = "";
  }

  #desiredTarget(): number {
    if (!this.workout) return 0;
    return trainerWatts(
      currentStep(this.workout, this.elapsed).step.watts + this.adjustment,
      this.trainer.capabilities.current?.powerRange,
    );
  }

  async #sendTarget(epoch: number): Promise<void> {
    const target = this.#desiredTarget();
    await this.trainer.setTargetPower(target);
    if (epoch === this.#epoch) this.target = target;
  }

  async #operate(operation: (epoch: number) => Promise<void>): Promise<void> {
    const epoch = this.#epoch;
    const pending = (async () => {
      try {
        await operation(epoch);
      } catch (error) {
        if (epoch !== this.#epoch) return;
        let reason = message(error);
        try {
          await this.#stopHardware();
        } catch {
          reason += " Resistance release could not be confirmed.";
        }
        if (epoch === this.#epoch)
          this.#interrupt(`${reason} Ride interrupted; reconnect before starting again.`);
      }
    })();
    this.#pending = pending;
    await pending;
    if (this.#pending === pending) this.#pending = undefined;
  }

  async #stopHardware(): Promise<void> {
    if (this.trainer.connection.current !== "ready") throw new Error("Trainer is disconnected.");
    // Stop also covers an uncertain start acknowledgement; never infer success from local state.
    await this.trainer.stop();
  }

  #interrupt(error: string): void {
    ++this.#epoch;
    this.error = error;
    this.status = "interrupted";
  }

  #record(delta: number): void {
    const telemetry = this.telemetry;
    const watts = telemetry?.instantaneousPowerWatts;
    const speed = telemetry?.instantaneousSpeedKph;
    if (watts !== undefined) {
      this.workKj += (Math.max(0, watts) * delta) / 1000;
      this.#measuredSeconds += delta;
    }
    if (speed !== undefined) this.distanceKm += (Math.max(0, speed) * delta) / 3600;
    const second = Math.floor(this.elapsed);
    if (second === this.#lastSample) return;
    this.#lastSample = second;
    this.samples.push({
      seconds: this.elapsed,
      watts: watts ?? null,
      cadence: telemetry?.instantaneousCadenceRpm ?? null,
      speed: speed ?? null,
      target: this.target,
    });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function checkpointMeasuredSeconds(
  workout: Workout,
  record: Omit<RideRecord, "version"> & { version: unknown },
  simulator: boolean,
  adjustment: number,
): number {
  if (
    record.version !== 1 ||
    record.completed ||
    record.simulator !== simulator ||
    record.name !== workout.name ||
    !Number.isFinite(Date.parse(record.startedAt)) ||
    !Number.isFinite(adjustment) ||
    ![record.seconds, record.workKj, record.distanceKm].every(nonnegative) ||
    (record.averagePower !== null && !nonnegative(record.averagePower))
  )
    throw new Error("This ride checkpoint is invalid or belongs to a different ride.");
  const validSteps = workout.steps.every(
    (step) =>
      nonnegative(step.watts) &&
      step.seconds > 0 &&
      (Number.isFinite(step.seconds) ||
        (workout.seconds === null && workout.steps.length === 1 && step.seconds === Infinity)),
  );
  if (
    workout.steps.length === 0 ||
    !validSteps ||
    (workout.seconds !== null &&
      (!nonnegative(workout.seconds) ||
        record.seconds >= workout.seconds ||
        Math.abs(
          workout.steps.reduce((seconds, step) => seconds + step.seconds, 0) - workout.seconds,
        ) > 0.001))
  ) {
    throw new Error("This workout is already complete or has an invalid duration.");
  }
  let previous = -1;
  for (const sample of record.samples) {
    if (
      !nonnegative(sample.seconds) ||
      sample.seconds < previous ||
      sample.seconds > record.seconds ||
      !nonnegative(sample.target) ||
      ![sample.watts, sample.cadence, sample.speed].every(
        (value) => value === null || Number.isFinite(value),
      )
    ) {
      throw new Error("This ride checkpoint contains invalid samples.");
    }
    previous = sample.seconds;
  }
  const legacyDuration =
    record.averagePower === null
      ? 0
      : record.averagePower > 0
        ? (record.workKj * 1000) / record.averagePower
        : record.seconds;
  const measured = record.measuredSeconds ?? Math.min(record.seconds, legacyDuration);
  if (!nonnegative(measured) || measured > record.seconds || (record.workKj > 0 && measured === 0))
    throw new Error("This ride checkpoint contains invalid measurements.");
  return measured;
}

function nonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
