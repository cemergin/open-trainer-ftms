import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockTrainer, MockFtmsTransport } from "@open-trainer/ftms/testing";
import { createTrainer } from "@open-trainer/ftms/transport";
import type { Trainer, TrainerTelemetry } from "@open-trainer/ftms";
import { Ride, type RideRecord } from "../src/ride";
import {
  createWorkout,
  currentStep,
  suggestedTarget,
  trainerWatts,
  WORKOUT_OPTIONS,
} from "../src/workout";

let trainers: Trainer[];
beforeEach(() => {
  trainers = [];
  vi.useFakeTimers();
});
afterEach(async () => {
  for (const trainer of trainers) await trainer.disconnect();
  vi.useRealTimers();
});
async function setup(delay = 0): Promise<{
  trainer: Trainer;
  transport: MockFtmsTransport;
  ride: Ride;
  tick: (seconds: number, telemetry?: Partial<TrainerTelemetry>) => Promise<void>;
  setClock: (ms: number) => void;
}> {
  const transport = new MockFtmsTransport({ controlResponseDelayMs: delay });
  const trainer = createTrainer(transport, { commandTimeoutMs: 500 });
  trainers.push(trainer);
  await trainer.connect();
  let clock = 0;
  const ride = new Ride(trainer, true, () => clock);
  const tick = async (seconds: number, telemetry?: Partial<TrainerTelemetry>): Promise<void> => {
    clock += seconds * 1000;
    await vi.advanceTimersByTimeAsync(250);
    if (trainer.telemetry.current) Object.assign(trainer.telemetry.current, telemetry);
    const pending = ride.tick();
    await vi.advanceTimersByTimeAsync(delay * 5);
    await pending;
  };
  return {
    trainer,
    transport,
    ride,
    tick,
    setClock: (ms: number) => {
      clock = ms;
    },
  };
}
const shortWorkout = {
  name: "Test ride",
  seconds: 6,
  steps: [
    { name: "Warm up", seconds: 2, watts: 60, effort: "easy" as const },
    { name: "Steady", seconds: 2, watts: 120, effort: "steady" as const },
    { name: "Cool down", seconds: 2, watts: 50, effort: "easy" as const },
  ],
};

describe("workout plans", () => {
  it("adds up to the chosen duration, including all five efforts", () => {
    for (const mode of ["endurance", "intervals"] as const) {
      for (const minutes of [15, 30, 45, 60]) {
        const workout = createWorkout(mode, minutes, 100);
        expect(workout.steps.reduce((sum, step) => sum + step.seconds, 0)).toBe(minutes * 60);
        expect(currentStep(workout, 0).step.name).toBe("Warm up");
        expect(currentStep(workout, minutes * 60).step.name).toBe("Cool down");
      }
    }
    expect(
      createWorkout("intervals", 30, 100).steps.filter((step) => step.effort === "hard"),
    ).toHaveLength(5);
    expect(createWorkout("free", 30, 100).seconds).toBeNull();
  });
  it("uses the next interval exactly at its boundary", () => {
    expect(currentStep(shortWorkout, 1.99).step.watts).toBe(60);
    expect(currentStep(shortWorkout, 2).step.watts).toBe(120);
  });
  it("provides distinct, complete ERG profiles for all timed presets", () => {
    const profiles = new Set<string>();
    for (const option of WORKOUT_OPTIONS.filter((option) => option.id !== "free")) {
      for (const minutes of [10, 30, 120]) {
        const workout = createWorkout(option.id, minutes, 100);
        expect(workout.name).toBe(option.name);
        expect(workout.steps.reduce((total, step) => total + step.seconds, 0)).toBeCloseTo(
          minutes * 60,
        );
        expect(workout.steps.every((step) => step.seconds > 0 && step.watts > 0)).toBe(true);
      }
      profiles.add(
        createWorkout(option.id, 30, 100)
          .steps.map((step) => step.watts)
          .join(","),
      );
    }
    expect(profiles.size).toBe(6);
    const mountain = createWorkout("mountain", 30, 100).steps;
    expect(mountain.find((step) => step.name === "The summit")?.watts).toBe(
      Math.max(...mountain.map((step) => step.watts)),
    );
    expect(WORKOUT_OPTIONS.find((option) => option.id === "hills")?.description).toContain(
      "ERG power profile",
    );
  });
  it("suggests transparent defaults and only lowers them from previous average power", () => {
    expect(suggestedTarget("recovery")).toBe(75);
    expect(suggestedTarget("endurance", 73)).toBe(70);
    expect(suggestedTarget("endurance", 300)).toBe(100);
    expect(suggestedTarget("mountain", 10)).toBe(25);
    expect(suggestedTarget("tempo", NaN)).toBe(100);
    expect(suggestedTarget("free", 0)).toBe(100);
  });
  it("rejects invalid settings and respects trainer bounds and increments", () => {
    expect(() => createWorkout("endurance", 30, NaN)).toThrow();
    expect(() => createWorkout("endurance", 30, 0)).toThrow();
    expect(() => createWorkout("endurance", 0, 100)).toThrow();
    const range = { minimum: 25, maximum: 248, increment: 10 };
    expect(trainerWatts(100, range)).toBe(105);
    expect(trainerWatts(999, range)).toBe(245);
    expect(trainerWatts(0, range)).toBe(25);
    expect(trainerWatts(900)).toBe(600);
    expect(trainerWatts(0, { minimum: -15, maximum: 100, increment: 20 })).toBe(5);
    expect(() => trainerWatts(NaN)).toThrow();
    expect(() => trainerWatts(100, { minimum: 700, maximum: 1000, increment: 10 })).toThrow();
  });
});

function checkpoint(overrides: Partial<RideRecord> = {}): RideRecord {
  return {
    version: 1,
    startedAt: "2026-09-27T10:00:00.000Z",
    name: shortWorkout.name,
    simulator: true,
    seconds: 2,
    distanceKm: 0.02,
    averagePower: 100,
    workKj: 0.2,
    measuredSeconds: 2,
    completed: false,
    samples: [{ seconds: 2, watts: 100, cadence: 80, speed: 36, target: 60 }],
    ...overrides,
  };
}

describe("ride recovery", () => {
  it("restores paused without commands or elapsed time, then acquires control only on explicit resume", async () => {
    const { ride, transport, tick } = await setup();
    const record = checkpoint();
    ride.restore(shortWorkout, record, 5);
    await tick(90);
    await ride.adjust(5);
    expect(ride.status).toBe("paused");
    expect(ride.elapsed).toBe(2);
    expect(ride.target).toBe(130);
    expect(ride.averagePower).toBe(100);
    expect(ride.startedAt).toBe(record.startedAt);
    expect(transport.commandHistory).toEqual([]);
    await ride.resume();
    expect(transport.commandHistory).toEqual([0x00, 0x05, 0x07]);
    await tick(1, { instantaneousPowerWatts: 100, instantaneousSpeedKph: 36 });
    expect(ride.elapsed).toBe(3);
    expect(ride.workKj).toBeCloseTo(0.3);
    expect(ride.distanceKm).toBeCloseTo(0.03);
    expect(ride.record().measuredSeconds).toBe(3);
    expect(ride.averagePower).toBe(100);
    expect(ride.samples).toHaveLength(2);
    expect(ride.samples[0]).not.toBe(record.samples[0]);
  });
  it("preserves exactly measured duration when the ride had missing telemetry", async () => {
    const { ride, tick } = await setup();
    ride.restore(
      shortWorkout,
      checkpoint({ seconds: 3, workKj: 0.201, averagePower: 101, measuredSeconds: 2 }),
    );
    expect(ride.averagePower).toBe(101);
    await ride.resume();
    await tick(1, { instantaneousPowerWatts: 100 });
    expect(ride.record().measuredSeconds).toBe(3);
    expect(ride.averagePower).toBe(100);
  });
  it("supports legacy checkpoints without measured duration and zero-power samples", async () => {
    const first = await setup();
    first.ride.restore(shortWorkout, checkpoint({ measuredSeconds: undefined }));
    expect(first.ride.averagePower).toBe(100);
    expect(first.ride.record().measuredSeconds).toBe(2);
    const second = await setup();
    second.ride.restore(
      shortWorkout,
      checkpoint({ averagePower: 0, workKj: 0, measuredSeconds: undefined }),
    );
    expect(second.ride.averagePower).toBe(0);
  });
  it("rejects completed, overrun, incompatible and corrupted checkpoints without changing the ride", async () => {
    const { ride, transport } = await setup();
    const invalid: Partial<RideRecord>[] = [
      { completed: true },
      { seconds: 6 },
      { seconds: -1 },
      { simulator: false },
      { startedAt: "bad-date" },
      { workKj: NaN },
      { measuredSeconds: 3 },
      { measuredSeconds: 0 },
      { samples: [{ seconds: 3, watts: 100, cadence: 80, speed: 36, target: 60 }] },
    ];
    for (const override of invalid)
      expect(() => ride.restore(shortWorkout, checkpoint(override))).toThrow();
    expect(() => ride.restore({ ...shortWorkout, steps: [] }, checkpoint())).toThrow();
    expect(() => ride.restore(shortWorkout, checkpoint(), NaN)).toThrow();
    expect(ride.status).toBe("ready");
    expect(ride.elapsed).toBe(0);
    expect(transport.commandHistory).toEqual([]);
  });
  it("can end while restored control acquisition is pending without issuing Start", async () => {
    const { ride, transport } = await setup(25);
    ride.restore(shortWorkout, checkpoint());
    const resume = ride.resume();
    const finish = ride.finish();
    await vi.advanceTimersByTimeAsync(150);
    await Promise.all([resume, finish]);
    expect(ride.status).toBe("finished");
    expect(transport.commandHistory).toEqual([0x00, 0x08]);
    expect(ride.elapsed).toBe(2);
  });
  it("can explicitly end a recovered paused ride without starting the trainer", async () => {
    const { ride, transport } = await setup();
    ride.restore(shortWorkout, checkpoint());
    await ride.finish();
    expect(ride.status).toBe("finished");
    expect(transport.commandHistory).toEqual([0x00, 0x08]);
    expect(ride.elapsed).toBe(2);
  });
  it("still pauses for missing telemetry after a recovered ride resumes", async () => {
    const { ride, setClock } = await setup();
    const workout = createWorkout("free", 30, 100);
    ride.restore(workout, checkpoint({ name: workout.name }));
    await ride.resume();
    for (let second = 1; second <= 7; second++) {
      setClock(second * 1000);
      await ride.tick();
    }
    expect(ride.status).toBe("paused");
    expect(ride.error).toContain("No fresh trainer data");
  });
});

describe("ride lifecycle against the FTMS simulator", () => {
  it("acquires control, sets warm-up power, starts, changes intervals, and stops at the finish", async () => {
    const { ride, trainer, transport, tick } = await setup();
    await ride.start(shortWorkout);
    expect(transport.commandHistory).toEqual([0x00, 0x05, 0x07]);
    expect(ride.status).toBe("riding");
    expect(ride.target).toBe(60);
    await tick(2);
    expect(ride.target).toBe(120);
    await tick(2);
    expect(ride.target).toBe(50);
    await tick(2);
    expect(ride.status).toBe("finished");
    expect(trainer.activity.current).toBe("idle");
    expect(transport.commandHistory.at(-1)).toBe(0x08);
    expect(ride.record().completed).toBe(true);
    expect(ride.record().simulator).toBe(true);
    expect(ride.elapsed).toBe(6);
    expect(ride.averagePower).toBeGreaterThan(0);
  });
  it("excludes paused time and keeps the target when resumed", async () => {
    const { ride, tick } = await setup();
    await ride.start(createWorkout("endurance", 30, 100));
    await tick(2);
    await ride.pause();
    await tick(100);
    expect(ride.elapsed).toBe(2);
    await ride.resume();
    await tick(1);
    expect(ride.elapsed).toBe(3);
    expect(ride.target).toBe(60);
  });
  it("prevents duplicate starts and can end while control acquisition is pending", async () => {
    const { ride, transport } = await setup(25);
    const start = ride.start(shortWorkout);
    const duplicate = ride.start(shortWorkout);
    await vi.advanceTimersByTimeAsync(0);
    const stop = ride.finish();
    await vi.advanceTimersByTimeAsync(150);
    await Promise.all([start, duplicate, stop]);
    expect(ride.status).toBe("finished");
    expect(transport.commandHistory).toEqual([0x00, 0x08]);
    expect(ride.elapsed).toBe(0);
  });
  it("does not send a late Start after ending during a power command", async () => {
    const { ride, transport } = await setup(25);
    const start = ride.start(shortWorkout);
    await vi.advanceTimersByTimeAsync(25);
    const stop = ride.finish();
    await vi.advanceTimersByTimeAsync(150);
    await Promise.all([start, stop]);
    expect(transport.commandHistory).toEqual([0x00, 0x05, 0x08]);
    expect(ride.status).toBe("finished");
  });
  it("stops after an already-sent Start acknowledgement without resuming the ride clock", async () => {
    const { ride, transport } = await setup(25);
    const start = ride.start(shortWorkout);
    await vi.advanceTimersByTimeAsync(50);
    const stop = ride.finish();
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([start, stop]);
    expect(transport.commandHistory).toEqual([0x00, 0x05, 0x07, 0x08]);
    expect(ride.status).toBe("finished");
    expect(ride.elapsed).toBe(0);
  });
  it("can end a pending resume without sending another Start", async () => {
    const { ride, transport } = await setup(25);
    const start = ride.start(shortWorkout);
    await vi.advanceTimersByTimeAsync(100);
    await start;
    const pause = ride.pause();
    await vi.advanceTimersByTimeAsync(25);
    await pause;
    const resume = ride.resume();
    const stop = ride.finish();
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([resume, stop]);
    expect(transport.commandHistory).toEqual([0x00, 0x05, 0x07, 0x08, 0x05, 0x08]);
    expect(ride.status).toBe("finished");
  });
  it("ends a free ride only when requested and adjusts watts", async () => {
    const { ride, tick, trainer } = await setup();
    await ride.start(createWorkout("free", 30, 100));
    await ride.adjust(5);
    expect(ride.target).toBe(105);
    for (let i = 0; i < 20; i++) await tick(1);
    expect(ride.status).toBe("riding");
    await ride.finish();
    expect(trainer.activity.current).toBe("idle");
    expect(ride.record().completed).toBe(false);
  });
  it("interrupts on disconnect, clears stale telemetry, and never restarts on reconnect", async () => {
    const { ride, tick, trainer } = await setup();
    await ride.start(shortWorkout);
    await tick(1);
    await trainer.disconnect();
    expect(ride.status).toBe("interrupted");
    expect(ride.telemetry).toBeNull();
    expect(ride.error).toContain("disconnected");
    await trainer.connect();
    await tick(10);
    expect(ride.status).toBe("interrupted");
    expect(ride.elapsed).toBe(1);
  });
  it("pauses after browser suspension without jumping through intervals", async () => {
    const { ride, tick, trainer } = await setup();
    await ride.start(shortWorkout);
    await tick(1);
    await tick(30);
    expect(ride.status).toBe("paused");
    expect(ride.elapsed).toBe(1);
    expect(trainer.activity.current).toBe("paused");
    expect(ride.error).toContain("sleep");
  });
  it("detects elapsed wall time after computer sleep even when browser timers did not run", async () => {
    const trainer = createMockTrainer();
    trainers.push(trainer);
    await trainer.connect();
    const ride = new Ride(trainer, true);
    await ride.start(shortWorkout);
    vi.setSystemTime(Date.now() + 30000);
    await ride.tick();
    expect(ride.status).toBe("paused");
    expect(ride.elapsed).toBe(0);
    expect(ride.error).toContain("sleep");
  });
  it("remembers browser suspension while a target command is pending", async () => {
    const { ride, tick, setClock } = await setup(25);
    const start = ride.start(createWorkout("free", 30, 100));
    await vi.advanceTimersByTimeAsync(100);
    await start;
    const adjustment = ride.adjust(5);
    setClock(30000);
    await ride.tick();
    expect(ride.elapsed).toBe(0);
    await vi.advanceTimersByTimeAsync(25);
    await adjustment;
    await tick(1);
    expect(ride.status).toBe("paused");
    expect(ride.error).toContain("sleep");
    expect(ride.elapsed).toBe(0);
  });
  it("pauses after sustained low cadence and allows pedaling time after resume", async () => {
    const { ride, tick } = await setup();
    await ride.start(createWorkout("free", 30, 100));
    for (let second = 1; second <= 15; second++) await tick(1, { instantaneousCadenceRpm: 0 });
    expect(ride.status).toBe("paused");
    expect(ride.error).toContain("Pedaling stopped");
    const elapsed = ride.elapsed;
    await ride.resume();
    for (let second = 1; second <= 5; second++) await tick(1, { instantaneousCadenceRpm: 0 });
    await tick(1, { instantaneousCadenceRpm: 80 });
    expect(ride.status).toBe("riding");
    expect(ride.elapsed).toBe(elapsed + 6);
  });
  it("pauses when telemetry becomes stale", async () => {
    const { ride, tick, setClock } = await setup();
    await ride.start(createWorkout("free", 30, 100));
    await tick(1);
    for (let second = 2; second <= 8; second++) {
      setClock(second * 1000);
      await ride.tick();
    }
    expect(ride.status).toBe("paused");
    expect(ride.telemetry).toBeNull();
    expect(ride.error).toContain("No fresh trainer data");
  });
  it("stops and interrupts if an interval command is rejected", async () => {
    const { ride, tick, trainer } = await setup();
    await ride.start(shortWorkout);
    vi.spyOn(trainer, "setTargetPower").mockRejectedValueOnce(new Error("Power command rejected"));
    await tick(2);
    expect(ride.status).toBe("interrupted");
    expect(ride.error).toContain("Power command rejected");
    expect(trainer.activity.current).toBe("idle");
    expect(ride.target).toBe(60);
  });
  it("adjusts by at least one supported increment and reports only acknowledged targets", async () => {
    const { ride, trainer } = await setup();
    const capabilities = trainer.capabilities.current;
    if (!capabilities) throw new Error("Missing trainer capabilities.");
    capabilities.powerRange = { minimum: 25, maximum: 248, increment: 10 };
    await ride.start(createWorkout("free", 30, 100));
    expect(ride.target).toBe(105);
    await ride.adjust(5);
    expect(ride.target).toBe(115);
    await ride.adjust(-5);
    expect(ride.target).toBe(105);
    await ride.adjust(1000);
    expect(ride.target).toBe(245);
    vi.spyOn(trainer, "setTargetPower").mockRejectedValueOnce(new Error("Power command rejected"));
    await ride.adjust(-5);
    expect(ride.target).toBe(245);
    expect(ride.status).toBe("interrupted");
  });
  it("integrates measured power and speed and excludes paused and missing data", async () => {
    const { ride, tick } = await setup();
    await ride.start(createWorkout("free", 30, 100));
    await tick(2, { instantaneousPowerWatts: 100, instantaneousSpeedKph: 36 });
    await tick(2, { instantaneousPowerWatts: 200, instantaneousSpeedKph: 18 });
    await ride.pause();
    await tick(60, { instantaneousPowerWatts: 900, instantaneousSpeedKph: 90 });
    await ride.resume();
    await tick(1, { instantaneousPowerWatts: undefined, instantaneousSpeedKph: undefined });
    expect(ride.elapsed).toBe(5);
    expect(ride.workKj).toBeCloseTo(0.6);
    expect(ride.averagePower).toBe(150);
    expect(ride.distanceKm).toBeCloseTo(0.03);
    expect(ride.samples.at(-1)?.watts).toBeNull();
  });
  it("preserves a disconnect interruption even if Stop resolves afterwards", async () => {
    const { ride, trainer } = await setup();
    await ride.start(shortWorkout);
    const stop = trainer.stop.bind(trainer);
    vi.spyOn(trainer, "stop").mockImplementationOnce(async () => {
      const response = await stop();
      await trainer.disconnect();
      return response;
    });
    await ride.finish();
    expect(ride.status).toBe("interrupted");
    expect(ride.error).toContain("disconnected");
  });
  it("preserves a disconnect explanation even if Pause resolves afterwards", async () => {
    const { ride, trainer } = await setup();
    await ride.start(shortWorkout);
    const pause = trainer.pause.bind(trainer);
    vi.spyOn(trainer, "pause").mockImplementationOnce(async () => {
      const response = await pause();
      await trainer.disconnect();
      return response;
    });
    await ride.pause();
    expect(ride.status).toBe("interrupted");
    expect(ride.error).toContain("disconnected");
  });
  it("reports an unconfirmed stop instead of claiming resistance was released", async () => {
    const { ride, trainer } = await setup();
    await ride.start(shortWorkout);
    vi.spyOn(trainer, "stop").mockRejectedValueOnce(new Error("Timed out"));
    await ride.finish();
    expect(ride.status).toBe("interrupted");
    expect(ride.error).toContain("resistance release was not confirmed");
    expect(ride.record().completed).toBe(false);
  });
  it("does not start unsupported trainers", async () => {
    const trainer = createMockTrainer();
    trainers.push(trainer);
    await trainer.connect();
    const capabilities = trainer.capabilities.current;
    if (!capabilities) throw new Error("Missing trainer capabilities.");
    capabilities.supportsPowerTarget = false;
    const ride = new Ride(trainer, true);
    await ride.start(shortWorkout);
    expect(ride.status).toBe("ready");
    expect(ride.error).toContain("does not support ERG");
  });
});
