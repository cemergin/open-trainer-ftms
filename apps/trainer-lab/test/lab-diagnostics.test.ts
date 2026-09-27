import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockFtmsTransport } from "@open-trainer/ftms/testing";
import { createTrainer } from "@open-trainer/ftms/transport";
import type { Trainer } from "../src/services";
import { LabControls, packetHex } from "../src/lab-diagnostics";

let trainers: Trainer[];
beforeEach(() => {
  trainers = [];
  vi.useFakeTimers();
});
afterEach(async () => {
  for (const trainer of trainers) await trainer.disconnect();
  vi.useRealTimers();
});
async function setup(
  simulator = true,
  delay = 0,
): Promise<{ transport: MockFtmsTransport; trainer: Trainer; controls: LabControls }> {
  const transport = new MockFtmsTransport({ controlResponseDelayMs: delay });
  const trainer = createTrainer(transport, { commandTimeoutMs: 500 });
  trainers.push(trainer);
  await trainer.connect();
  return { transport, trainer, controls: new LabControls(trainer, simulator) };
}

describe("Lab diagnostic controls", () => {
  it("runs the simulator sequence in the documented order", async () => {
    const { transport, trainer, controls } = await setup();
    expect(await controls.simulatorSequence()).toBe(true);
    expect(transport.commandHistory).toEqual([0x00, 0x05, 0x07]);
    expect(trainer.activity.current).toBe("running");
    await controls.stop();
    expect(trainer.activity.current).toBe("idle");
  });

  it("never runs the automatic sequence for a physical connection", async () => {
    const { transport, controls } = await setup(false);
    await expect(controls.simulatorSequence()).rejects.toThrow("only for the simulator");
    expect(transport.commandHistory).toEqual([]);
  });

  it("rejects duplicate actions while allowing Stop during acquisition", async () => {
    const { transport, trainer, controls } = await setup(true, 25);
    const sequence = controls.simulatorSequence();
    await vi.advanceTimersByTimeAsync(0);
    await expect(controls.run(() => trainer.start())).rejects.toThrow("pending command");
    expect(controls.targetsBlocked).toBe(true);
    await expect(controls.runTarget(() => trainer.setTargetPower(80))).rejects.toThrow(
      "pending command",
    );
    const stop = controls.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(await sequence).toBe(false);
    await stop;
    expect(transport.commandHistory).toEqual([0x00, 0x08]);
    expect(controls.busy).toBe(false);
  });

  it("coalesces delayed manual targets while keeping lifecycle controls busy until all settle", async () => {
    const { transport, trainer, controls } = await setup(true, 25);
    const acquisition = controls.run(() => trainer.acquireControl());
    await vi.advanceTimersByTimeAsync(25);
    await acquisition;
    const write = vi.spyOn(transport, "write");
    const active = controls.runTarget(() => trainer.setTargetPower(80));
    const replaced = controls.runTarget(() => trainer.setResistanceLevel(2));
    const latest = controls.runTarget(() => trainer.setTargetPower(100));

    await expect(replaced).resolves.toBe(false);
    expect(controls.pending).toBe(true);
    expect(controls.busy).toBe(true);
    expect(controls.targetsBlocked).toBe(false);
    for (const operation of [
      () => trainer.acquireControl(),
      () => trainer.start(),
      () => trainer.pause(),
      () => trainer.reset(),
      () => trainer.disconnect(),
    ])
      await expect(controls.run(operation)).rejects.toThrow("pending command");
    await expect(controls.simulatorSequence()).rejects.toThrow("pending command");

    await vi.advanceTimersByTimeAsync(25);
    await expect(active).resolves.toBe(true);
    expect(controls.busy).toBe(true);
    expect(controls.targetsBlocked).toBe(false);
    await vi.advanceTimersByTimeAsync(25);
    await expect(latest).resolves.toBe(true);
    expect(write.mock.calls.map(([, bytes]) => Array.from(bytes))).toEqual([
      [0x05, 80, 0],
      [0x05, 100, 0],
    ]);
    expect(controls.busy).toBe(false);
  });

  it("lets Stop cancel queued manual targets and rejects further targets until Stop settles", async () => {
    const { transport, trainer, controls } = await setup(false, 25);
    const acquisition = controls.run(() => trainer.acquireControl());
    await vi.advanceTimersByTimeAsync(25);
    await acquisition;
    const active = controls.runTarget(() => trainer.setTargetPower(80));
    const queued = controls.runTarget(() => trainer.setTargetPower(100));
    const stop = controls.stop();

    await expect(queued).resolves.toBe(false);
    expect(controls.pending).toBe(true);
    expect(controls.stopping).toBe(true);
    expect(controls.targetsBlocked).toBe(true);
    await expect(controls.runTarget(() => trainer.setTargetPower(120))).rejects.toThrow(
      "pending command",
    );
    await vi.advanceTimersByTimeAsync(25);
    await expect(active).resolves.toBe(true);
    expect(controls.pending).toBe(false);
    expect(controls.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(25);
    await stop;
    expect(transport.commandHistory).toEqual([0x00, 0x05, 0x08]);
    expect(controls.busy).toBe(false);
    expect(controls.targetsBlocked).toBe(false);
  });

  it("propagates failed manual targets instead of treating them as cancellations", async () => {
    const { transport, trainer, controls } = await setup();
    await expect(controls.runTarget(() => trainer.setTargetPower(80))).rejects.toThrow(
      "control not permitted",
    );
    expect(controls.busy).toBe(false);
    await controls.run(() => trainer.acquireControl());
    const failure = new Error("Radio write failed");
    vi.spyOn(transport, "write").mockRejectedValueOnce(failure);
    await expect(controls.runTarget(() => trainer.setTargetPower(80))).rejects.toMatchObject({
      code: "transport_failure",
      cause: failure,
    });
    expect(controls.busy).toBe(false);
    await expect(controls.runTarget(() => trainer.setTargetPower(80))).resolves.toBe(true);
  });

  it("does not send Start after Stop during the power-target step", async () => {
    const { transport, controls } = await setup(true, 25);
    const sequence = controls.simulatorSequence();
    await vi.advanceTimersByTimeAsync(25);
    const stop = controls.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(await sequence).toBe(false);
    await stop;
    expect(transport.commandHistory).toEqual([0x00, 0x05, 0x08]);
  });

  it("reports unconfirmed Stop failures and permits a retry", async () => {
    const { trainer, controls } = await setup();
    await controls.simulatorSequence();
    vi.spyOn(trainer, "stop").mockRejectedValueOnce(new Error("Timed out"));
    await expect(controls.stop()).rejects.toThrow(
      "Stop was not confirmed. Resistance release is unknown. Timed out",
    );
    expect(controls.busy).toBe(false);
    await controls.stop();
    expect(trainer.activity.current).toBe("idle");
  });

  it("stops after an already-sent Start without issuing another command", async () => {
    const { transport, trainer, controls } = await setup(true, 25);
    const sequence = controls.simulatorSequence();
    await vi.advanceTimersByTimeAsync(50);
    const stop = controls.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(await sequence).toBe(false);
    await stop;
    expect(transport.commandHistory).toEqual([0x00, 0x05, 0x07, 0x08]);
    expect(trainer.activity.current).toBe("idle");
  });

  it("exports every packet byte, including leading zeroes", () => {
    expect(packetHex(Uint8Array.of(0x80, 0x00, 0x01, 0xff))).toBe("80 00 01 FF");
  });
});
