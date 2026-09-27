import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RideCoach } from "../src/services/coaching";
import type { Ride } from "../src/ride";

const oscillator = (): Record<string, unknown> => ({
  frequency: { value: 0 },
  connect: vi.fn(() => ({ connect: vi.fn() })),
  start: vi.fn(),
  stop: vi.fn(),
  disconnect: vi.fn(),
});
const createOscillator = vi.fn(oscillator);
const resume = vi.fn(async () => undefined);
const speak = vi.fn();
const cancel = vi.fn();
let state = "running";
function ride(overrides: Record<string, unknown> = {}): Ride {
  return {
    status: "riding",
    startedAt: "2026-09-27T00:00:00Z",
    busy: false,
    workoutElapsed: 0,
    controlMode: "erg",
    target: 95,
    workout: {
      name: "Workout",
      seconds: 20,
      steps: [
        { name: "Warm up", watts: 100, seconds: 10, effort: "easy", cadenceRpm: 80 },
        { name: "Effort", watts: 200, seconds: 10, effort: "hard" },
      ],
    },
    ...overrides,
  } as unknown as Ride;
}
beforeEach(() => {
  vi.clearAllMocks();
  state = "running";
  resume.mockResolvedValue(undefined);
  vi.stubGlobal(
    "AudioContext",
    class {
      get state(): string {
        return state;
      }
      currentTime = 0;
      destination = {};
      resume = resume;
      createOscillator = createOscillator;
      createGain(): Record<string, unknown> {
        return {
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          disconnect: vi.fn(),
        };
      }
    },
  );
  vi.stubGlobal("speechSynthesis", { speak, cancel, speaking: true });
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      constructor(public text: string) {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("optional interval coaching", () => {
  it("stays silent until explicitly enabled and speaks acknowledged target with cadence", async () => {
    const coach = new RideCoach();
    coach.update(ride());
    expect(speak).not.toHaveBeenCalled();
    await coach.enable(true, true);
    coach.update(ride());
    coach.update(ride());
    expect(speak).toHaveBeenCalledOnce();
    expect(speak.mock.calls[0]?.[0].text).toBe("Warm up. 95 watts. Aim for 80 RPM.");
  });
  it("waits for pending control acknowledgements before announcing the next interval", async () => {
    const coach = new RideCoach();
    await coach.enable(true, true);
    coach.update(ride({ busy: true, workoutElapsed: 10 }));
    expect(speak).not.toHaveBeenCalled();
    coach.update(ride({ target: 185, workoutElapsed: 10 }));
    expect(speak.mock.calls[0]?.[0].text).toBe("Effort. 185 watts.");
  });
  it("beeps once per countdown second and cancels speech when paused", async () => {
    const coach = new RideCoach();
    await coach.enable(true, true);
    coach.update(ride());
    const before = createOscillator.mock.calls.length;
    coach.update(ride({ workoutElapsed: 7 }));
    coach.update(ride({ workoutElapsed: 7.2 }));
    expect(createOscillator.mock.calls.length).toBe(before + 1);
    coach.update(ride({ status: "paused" }));
    expect(cancel).toHaveBeenCalled();
  });
  it("does not announce power targets in resistance or terrain mode", async () => {
    const coach = new RideCoach();
    await coach.enable(true, true);
    coach.update(ride({ controlMode: "terrain" }));
    expect(speak.mock.calls[0]?.[0].text).not.toContain("watts");
  });
  it("does not keep speaking after audio permission failure", async () => {
    resume.mockRejectedValueOnce(new Error("denied"));
    const coach = new RideCoach();
    await expect(coach.enable(true, true)).rejects.toThrow("denied");
    coach.update(ride());
    expect(speak).not.toHaveBeenCalled();
  });
});
