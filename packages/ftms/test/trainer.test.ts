import { describe, expect, it, vi } from "vitest";
import { FtmsControlError, type TrainerTelemetry } from "../src/index.js";
import { createMockTrainer, MockFtmsTransport } from "../src/testing.js";
import { createTrainer } from "../src/transport.js";

describe("FtmsTrainer with the simulated transport", () => {
  it("discovers capabilities, controls ERG mode, and emits telemetry", async () => {
    const trainer = createMockTrainer({}, { commandTimeoutMs: 500 });
    expect(trainer.connection.current).toBe("disconnected");
    expect(trainer.control.current).toBe("unavailable");
    expect(trainer.activity.current).toBe("idle");

    const connectionStates: string[] = [];
    const unsubscribeConnection = trainer.connection.subscribe((state) => {
      connectionStates.push(state);
    });

    const capabilities = await trainer.connect();
    expect(capabilities.supportsPowerTarget).toBe(true);
    expect(capabilities.powerRange).toEqual({ minimum: 0, maximum: 1800, increment: 1 });
    expect(trainer.connection.current).toBe("ready");
    expect(connectionStates).toEqual(["disconnected", "connecting", "ready"]);

    await trainer.acquireControl();
    expect(trainer.control.current).toBe("owned");
    await trainer.setTargetPower(200);
    await trainer.start();
    expect(trainer.activity.current).toBe("running");

    const telemetry = await new Promise<TrainerTelemetry>((resolve) => {
      const unsubscribe = trainer.telemetry.subscribe((value) => {
        if (value && (value.instantaneousPowerWatts ?? 0) > 0) {
          unsubscribe();
          resolve(value);
        }
      });
    });

    expect(telemetry.instantaneousCadenceRpm).toBeGreaterThan(0);
    expect(telemetry.instantaneousPowerWatts).toBeGreaterThan(0);
    await trainer.stop();
    expect(trainer.activity.current).toBe("idle");
    await trainer.disconnect();
    expect(trainer.connection.current).toBe("disconnected");
    expect(trainer.telemetry.current).toBeNull();
    unsubscribeConnection();
  });

  it("surfaces control-not-permitted responses", async () => {
    const trainer = createMockTrainer({}, { commandTimeoutMs: 500 });
    await trainer.connect();
    await expect(trainer.start()).rejects.toBeInstanceOf(FtmsControlError);
    await trainer.disconnect();
  });

  it("runs only one FTMS control procedure at a time", async () => {
    vi.useFakeTimers();
    try {
      const transport = new MockFtmsTransport({ controlResponseDelayMs: 25 });
      const trainer = createTrainer(transport, { commandTimeoutMs: 500 });
      await trainer.connect();

      const acquire = trainer.acquireControl();
      const start = trainer.start();
      const power = trainer.setTargetPower(225);

      await vi.advanceTimersByTimeAsync(0);
      expect(transport.commandHistory).toEqual([0x00]);

      await vi.advanceTimersByTimeAsync(25);
      await acquire;
      expect(transport.commandHistory).toEqual([0x00, 0x07]);

      await vi.advanceTimersByTimeAsync(25);
      await start;
      expect(transport.commandHistory).toEqual([0x00, 0x07, 0x05]);

      await vi.advanceTimersByTimeAsync(25);
      await power;
      await trainer.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });
});
