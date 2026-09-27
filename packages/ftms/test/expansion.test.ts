import { afterEach, describe, expect, it, vi } from "vitest";
import { spinDownCommand, targetCadenceCommand, targetPowerCommand } from "../src/commands.js";
import { ControlPointQueue } from "../src/control-point-queue.js";
import { FtmsCapabilityError, FtmsProtocolError, FtmsRangeError } from "../src/errors.js";
import { MockFtmsTransport } from "../src/mock-transport.js";
import { parseMachineStatus, parseSpinDownResponse } from "../src/parsers.js";
import { FtmsTrainer } from "../src/trainer.js";
import type { CommandEvent } from "../src/types.js";
import { FTMS_UUIDS } from "../src/uuids.js";

const packet = (...bytes: number[]): DataView => new DataView(Uint8Array.from(bytes).buffer);
afterEach(() => vi.useRealTimers());

describe("decoded FTMS 1.0.1 machine parameters", () => {
  const cases = [
    [0x01, [], undefined],
    [0x02, [1], { control: "stop", controlCode: 1 }],
    [0x02, [2], { control: "pause", controlCode: 2 }],
    [0x02, [9], { control: "unknown", controlCode: 9 }],
    [0x03, [], undefined],
    [0x04, [], undefined],
    [0x05, [0xd2, 0x04], { speedKph: 12.34 }],
    [0x06, [0xce, 0xff], { inclinationPercent: -5 }],
    [0x07, [0xe7, 0xff], { resistanceLevel: -2.5 }],
    [0x08, [0xec, 0xff], { powerWatts: -20 }],
    [0x09, [150], { heartRateBpm: 150 }],
    [0x0a, [0x01, 0x02], { energyKcal: 513 }],
    [0x0b, [0x01, 0x02], { steps: 513 }],
    [0x0c, [0x01, 0x02], { strides: 513 }],
    [0x0d, [0x01, 0x02, 0x03], { distanceMeters: 197121 }],
    [0x0e, [0x01, 0x02], { timeSeconds: 513 }],
    [0x0f, [1, 0, 2, 0], { fatBurnSeconds: 1, fitnessSeconds: 2 }],
    [0x10, [1, 0, 2, 0, 3, 0], { lightSeconds: 1, moderateSeconds: 2, hardSeconds: 3 }],
    [
      0x11,
      [1, 0, 2, 0, 3, 0, 4, 0, 5, 0],
      {
        veryLightSeconds: 1,
        lightSeconds: 2,
        moderateSeconds: 3,
        hardSeconds: 4,
        maximumSeconds: 5,
      },
    ],
    [
      0x12,
      [0x18, 0xfc, 0x38, 0xff, 40, 51],
      { windSpeedMps: -1, gradePercent: -2, rollingResistance: 0.004, windResistanceKgPerM: 0.51 },
    ],
    [0x13, [0x08, 0x52], { circumferenceMm: 2100 }],
    [0x14, [1], { status: "requested", statusCode: 1 }],
    [0x14, [2], { status: "success", statusCode: 2 }],
    [0x14, [3], { status: "error", statusCode: 3 }],
    [0x14, [4], { status: "stop-pedaling", statusCode: 4 }],
    [0x14, [255], { status: "unknown", statusCode: 255 }],
    [0x15, [181, 0], { cadenceRpm: 90.5 }],
    [0xff, [], undefined],
  ] as const;
  it.each(cases)("decodes opcode %i without losing raw bytes", (opcode, bytes, expected) => {
    const input = Uint8Array.from([99, opcode, ...bytes, 99]);
    const result = parseMachineStatus(new DataView(input.buffer, 1, bytes.length + 1));
    expect(result.decodedParameters).toEqual(expected);
    expect(result.parameters).toEqual(Uint8Array.from(bytes));
    input.fill(0);
    expect(result.parameters).toEqual(Uint8Array.from(bytes));
  });
  it.each(cases)("rejects incorrect known-opcode lengths for %i", (opcode, bytes) => {
    expect(() => parseMachineStatus(packet(opcode, ...bytes, 0))).toThrow(FtmsProtocolError);
    if (bytes.length)
      expect(() => parseMachineStatus(packet(opcode, ...bytes.slice(1)))).toThrow(
        FtmsProtocolError,
      );
  });
  it("preserves opaque future opcodes", () => {
    expect(parseMachineStatus(packet(0x80, 9))).toEqual({
      kind: "unknown",
      opcode: 0x80,
      parameters: Uint8Array.of(9),
    });
  });
});

describe("cadence and spin-down commands", () => {
  it("encodes half-RPM cadence and the specified start/ignore control", () => {
    expect(targetCadenceCommand(90.5)).toEqual(Uint8Array.of(0x14, 181, 0));
    expect(targetCadenceCommand(32767.5)).toEqual(Uint8Array.of(0x14, 255, 255));
    for (const value of [-1, 0.1, 32768, NaN, Infinity])
      expect(() => targetCadenceCommand(value)).toThrow(FtmsRangeError);
    expect(spinDownCommand("start")).toEqual(Uint8Array.of(0x13, 1));
    expect(spinDownCommand("ignore")).toEqual(Uint8Array.of(0x13, 2));
    expect(() => spinDownCommand("stop" as "start")).toThrow(FtmsRangeError);
  });
  it("rejects malformed successful spin-down speed windows", () => {
    for (const response of [
      { requestOpcode: 0x12, resultCode: 1, responseParameters: new Uint8Array(4) },
      { requestOpcode: 0x13, resultCode: 2, responseParameters: new Uint8Array(4) },
      { requestOpcode: 0x13, resultCode: 1, responseParameters: new Uint8Array(3) },
      { requestOpcode: 0x13, resultCode: 1, responseParameters: new Uint8Array(5) },
    ])
      expect(() => parseSpinDownResponse({ responseOpcode: 0x80, ...response })).toThrow(
        FtmsProtocolError,
      );
  });
  it("gates capabilities and retains control rejection semantics", async () => {
    const trainer = new FtmsTrainer(new MockFtmsTransport());
    await trainer.connect();
    await expect(trainer.setTargetCadence(90)).rejects.toBeInstanceOf(FtmsCapabilityError);
    await expect(trainer.spinDown("start")).rejects.toBeInstanceOf(FtmsCapabilityError);
    await trainer.disconnect();
    const enabled = new FtmsTrainer(
      new MockFtmsTransport({ supportsTargetCadence: true, supportsSpindown: true }),
    );
    await enabled.connect();
    await expect(enabled.setTargetCadence(90)).rejects.toMatchObject({ code: "control_rejected" });
    await expect(enabled.spinDown("start")).rejects.toMatchObject({ code: "control_rejected" });
    await enabled.acquireControl();
    await expect(enabled.setTargetCadence(90.5)).resolves.toMatchObject({ requestOpcode: 0x14 });
    await expect(enabled.spinDown("start")).resolves.toMatchObject({
      targetSpeedLowKph: 20,
      targetSpeedHighKph: 30,
    });
    await expect(enabled.spinDown("ignore")).resolves.toMatchObject({
      targetSpeedLowKph: 20,
      targetSpeedHighKph: 30,
    });
    await enabled.disconnect();
  });
});

describe("command diagnostics", () => {
  it("reports accepted/rejected commands and keeps IDs across reconnects", async () => {
    const trainer = new FtmsTrainer(new MockFtmsTransport());
    const events: CommandEvent[] = [];
    trainer.commandEvents.subscribe((event) => events.push(event));
    await trainer.connect();
    await expect(trainer.setTargetPower(100)).rejects.toMatchObject({ code: "control_rejected" });
    await trainer.acquireControl();
    await trainer.disconnect();
    await trainer.connect();
    await trainer.acquireControl();
    expect(events.map((event) => [event.id, event.phase])).toEqual([
      [1, "queued"],
      [1, "sent"],
      [1, "rejected"],
      [2, "queued"],
      [2, "sent"],
      [2, "acknowledged"],
      [3, "queued"],
      [3, "sent"],
      [3, "acknowledged"],
    ]);
    expect(events[2]).toMatchObject({ resultCode: 5, errorCode: "control_rejected" });
    expect(events.every((event) => event.elapsedMs >= 0)).toBe(true);
    expect(events[8]?.latencyMs).toBeGreaterThanOrEqual(0);
    await trainer.disconnect();
  });
  it("reports superseded, cancelled and timed-out terminal phases once", async () => {
    vi.useFakeTimers();
    const transport = new MockFtmsTransport({ controlResponseDelayMs: 100 });
    await transport.connect();
    const queue = new ControlPointQueue(transport, 20);
    const events: CommandEvent[] = [];
    queue.commandEvents.subscribe((event) => events.push(event));
    await queue.open();
    const first = queue.execute(targetPowerCommand(100)).catch(() => undefined);
    const stale = queue
      .execute(targetPowerCommand(101), { coalesceKey: "power" })
      .catch(() => undefined);
    const latest = queue
      .execute(targetPowerCommand(102), { coalesceKey: "power" })
      .catch(() => undefined);
    queue.cancelQueued(new Error("lost control"));
    await vi.advanceTimersByTimeAsync(20);
    await Promise.all([first, stale, latest]);
    expect(
      events
        .filter((event) => !["queued", "sent"].includes(event.phase))
        .map((event) => [event.id, event.phase]),
    ).toEqual([
      [2, "superseded"],
      [3, "cancelled"],
      [1, "timedout"],
    ]);
    const timedout = events.at(-1);
    expect(timedout).toMatchObject({ elapsedMs: 20, latencyMs: 20 });
    queue.close();
    await transport.disconnect();
  });
  it("cancels an in-flight command and isolates subscriber exceptions", async () => {
    const transport = new MockFtmsTransport({ controlResponseDelayMs: 100 });
    await transport.connect();
    const queue = new ControlPointQueue(transport, 200);
    await queue.open();
    const events: CommandEvent[] = [];
    const errors: Error[] = [];
    queue.commandEvents.subscribe((event) => events.push(event));
    queue.commandEvents.subscribe(() => {
      throw new Error("subscriber");
    });
    queue.errors.subscribe((error) => errors.push(error));
    const pending = queue.execute(targetPowerCommand(100)).catch(() => undefined);
    queue.close();
    await pending;
    expect(events.at(-1)?.phase).toBe("cancelled");
    expect(errors).toHaveLength(3);
    await transport.disconnect();
  });
  it("does not send a command cancelled by an event subscriber", async () => {
    const transport = new MockFtmsTransport();
    await transport.connect();
    const queue = new ControlPointQueue(transport, 100);
    await queue.open();
    queue.commandEvents.subscribe((event) => {
      if (event.phase === "sent") queue.close();
    });
    await expect(queue.execute(targetPowerCommand(100))).rejects.toMatchObject({
      code: "operation_closed",
    });
    expect(transport.commandHistory).toEqual([]);
    await transport.disconnect();
  });
  it("covers raw mock validation and clears delayed replies across reconnect", async () => {
    vi.useFakeTimers();
    const transport = new MockFtmsTransport({
      supportsTargetCadence: true,
      supportsSpindown: true,
      controlResponseDelayMs: 5,
    });
    await transport.connect();
    await transport.write(FTMS_UUIDS.controlPoint, Uint8Array.of(0));
    await transport.write(FTMS_UUIDS.controlPoint, Uint8Array.of(0x14));
    await transport.write(FTMS_UUIDS.controlPoint, Uint8Array.of(0x13, 3));
    await transport.disconnect();
    await transport.connect();
    const listener = vi.fn();
    await transport.subscribe(FTMS_UUIDS.controlPoint, listener);
    await vi.advanceTimersByTimeAsync(5);
    expect(listener).not.toHaveBeenCalled();
    await transport.disconnect();
  });
});

describe("safety actions cancel queued calibration", () => {
  it.each(["stop", "pause", "reset"] as const)(
    "%s prevents a queued spin-down from starting afterward",
    async (action) => {
      vi.useFakeTimers();
      const transport = new MockFtmsTransport({
        supportsSpindown: true,
        controlResponseDelayMs: 20,
      });
      const trainer = new FtmsTrainer(transport);
      await trainer.connect();
      const control = trainer.acquireControl();
      await vi.advanceTimersByTimeAsync(20);
      await control;
      const power = trainer.setTargetPower(100);
      const calibration = expect(trainer.spinDown("start")).rejects.toMatchObject({
        code: "command_superseded",
      });
      const safety = trainer[action]();
      await vi.advanceTimersByTimeAsync(40);
      await Promise.all([power, calibration, safety]);
      expect(transport.commandHistory).toEqual([0, 5, action === "reset" ? 1 : 8]);
      await trainer.disconnect();
    },
  );
  it("generates distinct bounded simulator outputs after switching control modes", async () => {
    vi.useFakeTimers();
    const trainer = new FtmsTrainer(new MockFtmsTransport());
    await trainer.connect();
    await trainer.acquireControl();
    await trainer.setTargetPower(0);
    await trainer.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(trainer.telemetry.current?.instantaneousPowerWatts).toBe(0);
    await trainer.setResistanceLevel(10);
    await vi.advanceTimersByTimeAsync(3000);
    expect(trainer.telemetry.current?.instantaneousPowerWatts).toBe(180);
    await trainer.setSimulation({ gradePercent: 5 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(trainer.telemetry.current?.instantaneousPowerWatts).toBe(220);
    await trainer.setTargetPower(100);
    await vi.advanceTimersByTimeAsync(3000);
    expect(trainer.telemetry.current?.instantaneousPowerWatts).toBe(100);
    await trainer.disconnect();
  });
});
