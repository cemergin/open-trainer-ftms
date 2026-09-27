import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockTrainer } from "@open-trainer/ftms/testing";
import type { Trainer, TrainerTelemetry } from "@open-trainer/ftms";
import { Ride, type RideRecord } from "../src/ride";
import { rideCsv } from "../src/services/storage";
import type { SensorSourceSnapshot } from "../src/services/sensors";
import { resistanceTarget, supportsMode, terrainTarget } from "../src/ride-control";
import { compatibleGhosts, findRoute, ghostDistance, routeGrade } from "../src/routes";
import { currentStep, type Workout } from "../src/workout";

const workout: Workout = {
  name: "Ramp intervals",
  seconds: 30,
  steps: [
    { name: "Build", seconds: 10, watts: 100, endWatts: 200, cadenceRpm: 90, effort: "hard" },
    { name: "Recover", seconds: 10, watts: 75, effort: "easy" },
    { name: "Finish", seconds: 10, watts: 120, effort: "steady" },
  ],
};
let trainers: Trainer[];
let rides: Ride[];
beforeEach(() => {
  vi.useFakeTimers();
  trainers = [];
  rides = [];
});
afterEach(async () => {
  for (const ride of rides) ride.dispose();
  for (const trainer of trainers) await trainer.disconnect();
  vi.useRealTimers();
});

async function setup(sourceSnapshot?: () => SensorSourceSnapshot): Promise<{
  trainer: Trainer;
  ride: Ride;
  tick: (seconds: number, telemetry?: Partial<TrainerTelemetry>) => Promise<void>;
  recover: (plan: Workout, record: RideRecord, adjustment?: number) => Ride;
}> {
  const trainer = createMockTrainer();
  trainers.push(trainer);
  await trainer.connect();
  let clock = 0;
  const ride = new Ride(
    trainer,
    true,
    () => clock,
    (value) => value,
    sourceSnapshot,
  );
  rides.push(ride);
  return {
    trainer,
    ride,
    tick: async (seconds, telemetry = {}) => {
      clock += seconds * 1000;
      await vi.advanceTimersByTimeAsync(250);
      if (trainer.telemetry.current)
        Object.assign(trainer.telemetry.current, {
          instantaneousPowerWatts: 100,
          instantaneousCadenceRpm: 80,
          instantaneousSpeedKph: 36,
          ...telemetry,
        });
      await ride.tick();
    },
    recover: (plan, record, adjustment = 0) => {
      const recovered = new Ride(trainer, true, () => clock);
      recovered.restore(plan, record, adjustment);
      rides.push(recovered);
      return recovered;
    },
  };
}

describe("ride control modes", () => {
  it.each(["erg", "resistance", "terrain"] as const)(
    "sends only the %s target command",
    async (controlMode) => {
      const { ride, trainer, tick } = await setup();
      const power = vi.spyOn(trainer, "setTargetPower");
      const resistance = vi.spyOn(trainer, "setResistanceLevel");
      const simulation = vi.spyOn(trainer, "setSimulation");
      await ride.start(workout, { controlMode, resistance: 7, routeId: "rolling-v1" });
      expect(ride.status).toBe("riding");
      expect(power).toHaveBeenCalledTimes(controlMode === "erg" ? 1 : 0);
      expect(resistance).toHaveBeenCalledTimes(controlMode === "resistance" ? 1 : 0);
      expect(simulation).toHaveBeenCalledTimes(controlMode === "terrain" ? 1 : 0);
      if (controlMode === "erg") expect(power).toHaveBeenLastCalledWith(100);
      if (controlMode === "resistance") expect(resistance).toHaveBeenLastCalledWith(7);
      if (controlMode === "terrain")
        expect(simulation).toHaveBeenLastCalledWith({ gradePercent: 0 });
      await tick(1);
      const record = ride.record();
      expect(record.controlMode).toBe(controlMode);
      expect(record.samples[0]?.target).toBe(controlMode === "erg" ? 100 : 0);
      if (controlMode === "resistance") expect(record.samples[0]?.resistance).toBe(7);
      if (controlMode === "terrain") expect(record.routeId).toBe("rolling-v1");
    },
  );

  it.each([
    ["erg", "supportsPowerTarget"],
    ["resistance", "supportsResistanceTarget"],
    ["terrain", "supportsSimulation"],
  ] as const)(
    "gates unsupported %s before taking trainer control",
    async (controlMode, feature) => {
      const { ride, trainer } = await setup();
      const capabilities = trainer.capabilities.current;
      if (!capabilities) throw new Error("Mock trainer capabilities are required.");
      capabilities[feature] = false;
      const acquire = vi.spyOn(trainer, "acquireControl");
      expect(supportsMode(capabilities, controlMode)).toBe(false);
      await ride.start(workout, { controlMode });
      expect(acquire).not.toHaveBeenCalled();
      expect(ride.status).toBe("ready");
      expect(ride.error).toContain("does not support");
      expect(supportsMode(null, controlMode)).toBe(false);
    },
  );

  it("adjusts resistance in native increments and terrain in half-percent grade steps", async () => {
    const resistanceRide = await setup();
    const resistance = vi.spyOn(resistanceRide.trainer, "setResistanceLevel");
    await resistanceRide.ride.start(workout, { controlMode: "resistance", resistance: 7 });
    await resistanceRide.ride.adjust(5);
    expect(resistance).toHaveBeenLastCalledWith(8);
    expect(resistanceRide.ride.target).toBe(0);
    const terrainRide = await setup();
    const simulation = vi.spyOn(terrainRide.trainer, "setSimulation");
    await terrainRide.ride.start(workout, { controlMode: "terrain", routeId: "riverside-v1" });
    await terrainRide.ride.adjust(-5);
    expect(simulation).toHaveBeenLastCalledWith({ gradePercent: -0.5 });
    expect(terrainRide.ride.adjustment).toBe(-0.5);
  });
});

describe("interval clocks and recovery", () => {
  it("identifies the sensor used for each captured sample when sources change between ticks", async () => {
    let sources: SensorSourceSnapshot = {
      power: { source: "trainer", sensorName: null, simulator: null },
      cadence: { source: "trainer", sensorName: null, simulator: null },
      heartRate: { source: "none", sensorName: null, simulator: null },
    };
    const { ride, tick } = await setup(() => sources);
    await ride.start(workout);
    await tick(1);
    sources = {
      ...sources,
      power: { source: "external", sensorName: "Power meter", simulator: false },
    };
    await tick(1);
    const exported = rideCsv(ride.record())
      .split("\n")
      .map((row) => row.split(","));
    const powerColumn = exported[0]?.indexOf("power_source") ?? -1;
    expect(powerColumn).toBeGreaterThan(-1);
    expect(exported[1]?.[powerColumn]).toBe("trainer");
    expect(exported[2]?.[powerColumn]).toBe("external");
  });
  it("skips workout time without inventing activity time, distance, work, or samples", async () => {
    const { ride, tick } = await setup();
    await ride.start(workout);
    await tick(5);
    const before = ride.record();
    await ride.skipInterval();
    const after = ride.record();
    expect(after.seconds).toBe(5);
    expect(after.workoutElapsed).toBe(10);
    expect(after.distanceKm).toBe(before.distanceKm);
    expect(after.workKj).toBe(before.workKj);
    expect(after.samples).toEqual(before.samples);
    expect(ride.target).toBe(75);
    await tick(2);
    expect(ride.elapsed).toBe(7);
    expect(ride.workoutElapsed).toBe(12);
    await ride.skipInterval();
    await ride.skipInterval();
    expect(ride.status).toBe("finished");
    expect(ride.record()).toMatchObject({ seconds: 7, workoutElapsed: 30, completed: true });
  });

  it("extends a ramp without mutating the selected plan and recovers its independent clock", async () => {
    const { ride, trainer, tick, recover } = await setup();
    await ride.start(workout);
    await tick(5);
    ride.extendInterval(10);
    expect(workout.seconds).toBe(30);
    expect(workout.steps[0]?.seconds).toBe(10);
    expect(ride.workout?.seconds).toBe(40);
    expect(ride.workout?.steps[0]).toMatchObject({
      seconds: 20,
      watts: 100,
      endWatts: 200,
      cadenceRpm: 90,
    });
    await ride.skipInterval();
    await ride.pause();
    if (!ride.workout) throw new Error("Workout is required.");
    const power = vi.spyOn(trainer, "setTargetPower");
    power.mockClear();
    const recovered = recover(ride.workout, ride.record());
    expect(recovered.status).toBe("paused");
    expect(recovered.elapsed).toBe(5);
    expect(recovered.workoutElapsed).toBe(20);
    expect(power).not.toHaveBeenCalled();
    await recovered.resume();
    expect(power).toHaveBeenLastCalledWith(75);
  });

  it("resumes inside a ramp at the interpolated target, and rejects invalid extensions", async () => {
    const { ride, trainer, tick, recover } = await setup();
    await ride.start(workout);
    await tick(5);
    await ride.pause();
    for (const seconds of [-1, 0, NaN, Infinity, 601]) ride.extendInterval(seconds);
    expect(ride.workout?.seconds).toBe(30);
    const recovered = recover(workout, ride.record(), 10);
    expect(currentStep(workout, recovered.workoutElapsed).step.watts).toBe(150);
    expect(recovered.target).toBe(160);
    const power = vi.spyOn(trainer, "setTargetPower");
    await recovered.resume();
    expect(power).toHaveBeenLastCalledWith(160);
  });

  it("changes a paused interval locally and sends the new target only on resume", async () => {
    const { ride, trainer, tick } = await setup();
    await ride.start(workout);
    await tick(2);
    await ride.pause();
    const power = vi.spyOn(trainer, "setTargetPower");
    await ride.skipInterval();
    expect(ride.workoutElapsed).toBe(10);
    expect(ride.elapsed).toBe(2);
    expect(ride.target).toBe(75);
    expect(power).not.toHaveBeenCalled();
    await ride.resume();
    expect(power).toHaveBeenLastCalledWith(75);
  });

  it.each(["resistance", "terrain"] as const)(
    "restores %s metadata and checks capabilities again on resume",
    async (controlMode) => {
      const { ride, trainer, tick, recover } = await setup();
      await ride.start(workout, { controlMode, resistance: 7, routeId: "rolling-v1" });
      await tick(1);
      await ride.adjust(5);
      await ride.pause();
      const recovered = recover(workout, ride.record(), ride.adjustment);
      expect(recovered.controlMode).toBe(controlMode);
      expect(recovered.controlTarget).toBe(ride.controlTarget);
      expect(recovered.target).toBe(0);
      if (controlMode === "terrain") expect(recovered.routeId).toBe("rolling-v1");
      const resistance = vi.spyOn(trainer, "setResistanceLevel");
      const simulation = vi.spyOn(trainer, "setSimulation");
      await recovered.resume();
      if (controlMode === "resistance") expect(resistance).toHaveBeenLastCalledWith(8);
      else expect(simulation).toHaveBeenLastCalledWith({ gradePercent: recovered.controlTarget });
      await recovered.pause();
      const capabilities = trainer.capabilities.current;
      if (!capabilities) throw new Error("Mock trainer capabilities are required.");
      capabilities[
        controlMode === "resistance" ? "supportsResistanceTarget" : "supportsSimulation"
      ] = false;
      const start = vi.spyOn(trainer, "start");
      await recovered.resume();
      expect(start).not.toHaveBeenCalled();
      expect(recovered.status).toBe("paused");
      expect(recovered.error).toContain("recovered");
    },
  );
});

describe("terrain routes and local ghosts", () => {
  const record: RideRecord = {
    version: 1,
    startedAt: "2026-09-27T12:00:00Z",
    name: "Route ride",
    simulator: false,
    seconds: 20,
    distanceKm: 0.3,
    averagePower: null,
    workKj: 0,
    completed: true,
    controlMode: "terrain",
    routeId: "rolling-v1",
    samples: [
      { seconds: 10, watts: null, cadence: null, speed: 36, target: 0, distanceKm: 0.1 },
      { seconds: 20, watts: null, cadence: null, speed: 72, target: 0, distanceKm: 0.3 },
    ],
  };
  it("interpolates grade between route points and loops at the route end", () => {
    const route = findRoute("rolling-v1");
    expect(routeGrade(route, 0.5)).toBe(1);
    expect(routeGrade(route, 2)).toBe(4);
    expect(routeGrade(route, 10.5)).toBe(1);
    expect(terrainTarget("summit-v1", 4, 5)).toBe(8);
    expect(terrainTarget("summit-v1", 8, -5)).toBe(-5);
    expect(resistanceTarget(12, { minimum: 0, maximum: 10, increment: 0.5 })).toBe(10);
    expect(resistanceTarget(3.7, { minimum: 0, maximum: 10, increment: 0.5 })).toBe(3.5);
  });
  it("only compares the same route and source, and requires recorded distance", () => {
    const candidates = [
      record,
      { ...record, simulator: true },
      { ...record, routeId: "summit-v1" },
      { ...record, controlMode: "erg" as const },
      { ...record, samples: [] },
    ];
    expect(compatibleGhosts(candidates, "rolling-v1", false)).toEqual([record]);
    expect(compatibleGhosts(candidates, "rolling-v1", true)).toEqual([candidates[1]]);
  });

  it("keeps a capped resistance target on the trainer's advertised increment grid", () => {
    expect(resistanceTarget(100, { minimum: 0, maximum: 10.2, increment: 0.5 })).toBe(10);
    expect(resistanceTarget(100, { minimum: 0.3, maximum: 10, increment: 0.5 })).toBe(9.8);
  });
  it("interpolates ghost distance by actual ride seconds and stops after its activity ends", () => {
    expect(ghostDistance(record, 0)).toBe(0);
    expect(ghostDistance(record, 5)).toBeCloseTo(0.05);
    expect(ghostDistance(record, 15)).toBeCloseTo(0.2);
    expect(ghostDistance(record, 20)).toBeCloseTo(0.3);
    expect(ghostDistance(record, 21)).toBeNull();
  });
});
