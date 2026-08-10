import { describe, expect, it, vi } from "vitest";
import { stopCommand, targetPowerCommand } from "../src/commands.js";
import { ControlPointQueue } from "../src/control-point-queue.js";
import { FTMS_ERROR_CODE, FtmsProtocolError } from "../src/errors.js";
import { MockFtmsTransport } from "../src/mock-transport.js";
import { FTMS_UUIDS } from "../src/uuids.js";

class RejectingWriteTransport extends MockFtmsTransport {
  override write(): Promise<void> {
    return Promise.reject(new Error("write failed"));
  }
}

class RejectingSubscribeTransport extends MockFtmsTransport {
  override subscribe(
    characteristic: string,
    listener: (value: DataView) => void,
  ): Promise<() => void> {
    if (characteristic === FTMS_UUIDS.controlPoint) {
      return Promise.reject(new Error("subscribe failed"));
    }
    return super.subscribe(characteristic, listener);
  }
}

describe("ControlPointQueue", () => {
  it("quarantines a timed-out opcode until its late response is discarded", async () => {
    vi.useFakeTimers();
    try {
      const options = { controlResponseDelayMs: 100 };
      const transport = new MockFtmsTransport(options);
      await transport.connect();
      const queue = new ControlPointQueue(transport, 10);
      await queue.open();

      const first = queue.execute(targetPowerCommand(100));
      const firstRejection = expect(first).rejects.toMatchObject({
        code: FTMS_ERROR_CODE.commandTimeout,
      });
      await vi.advanceTimersByTimeAsync(10);
      await firstRejection;

      await expect(queue.execute(targetPowerCommand(110))).rejects.toMatchObject({
        code: FTMS_ERROR_CODE.commandDesynchronized,
      });

      await vi.advanceTimersByTimeAsync(90);
      options.controlResponseDelayMs = 5;
      const third = queue.execute(targetPowerCommand(120));
      await vi.advanceTimersByTimeAsync(5);
      await expect(third).resolves.toMatchObject({ requestOpcode: 0x05 });
      queue.close();
      await transport.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports malformed indications instead of silently dropping them", async () => {
    const transport = new MockFtmsTransport();
    await transport.connect();
    const queue = new ControlPointQueue(transport, 100);
    await queue.open();
    const errors: Error[] = [];
    queue.errors.subscribe((error) => errors.push(error));

    transport.emitNotification(FTMS_UUIDS.controlPoint, Uint8Array.of(0x80, 0x05));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(FtmsProtocolError);
    queue.close();
    await transport.disconnect();
  });

  it("rejects empty commands and commands sent after close with stable codes", async () => {
    const transport = new MockFtmsTransport();
    await transport.connect();
    const queue = new ControlPointQueue(transport, 100);
    await queue.open();

    await expect(queue.execute(new Uint8Array())).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.invalidPacket,
    });
    queue.close("test closed");
    await expect(queue.execute(targetPowerCommand(100))).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.operationClosed,
    });
    await transport.disconnect();
  });

  it("rejects an in-flight command immediately when closed", async () => {
    const transport = new MockFtmsTransport({ controlResponseDelayMs: 100 });
    await transport.connect();
    const queue = new ControlPointQueue(transport, 500);
    await queue.open();
    const command = queue.execute(targetPowerCommand(100));
    await Promise.resolve();

    queue.close("connection lost");

    await expect(command).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.operationClosed,
      message: "connection lost",
    });
    await transport.disconnect();
  });

  it("normalizes transport write failures", async () => {
    const transport = new RejectingWriteTransport();
    await transport.connect();
    const queue = new ControlPointQueue(transport, 100);
    await queue.open();

    await expect(queue.execute(targetPowerCommand(100))).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.transportFailure,
    });

    queue.close();
    await transport.disconnect();
  });

  it("normalizes subscription failures and remains closed", async () => {
    const transport = new RejectingSubscribeTransport();
    await transport.connect();
    const queue = new ControlPointQueue(transport, 100);

    await expect(queue.open()).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.transportFailure,
    });
    await expect(queue.execute(targetPowerCommand(100))).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.operationClosed,
    });
    await transport.disconnect();
  });

  it("coalesces queued setpoints and reports the superseded command", async () => {
    vi.useFakeTimers();
    try {
      const transport = new MockFtmsTransport({ controlResponseDelayMs: 25 });
      await transport.connect();
      const queue = new ControlPointQueue(transport, 100);
      await queue.open();

      const active = queue.execute(targetPowerCommand(100), { coalesceKey: "setpoint" });
      await vi.advanceTimersByTimeAsync(0);
      const stale = queue.execute(targetPowerCommand(110), { coalesceKey: "setpoint" });
      const latest = queue.execute(targetPowerCommand(120), { coalesceKey: "setpoint" });

      await expect(stale).rejects.toMatchObject({
        code: FTMS_ERROR_CODE.commandSuperseded,
      });
      await vi.advanceTimersByTimeAsync(25);
      await active;
      expect(transport.commandHistory).toEqual([0x05, 0x05]);
      await vi.advanceTimersByTimeAsync(25);
      await latest;
      queue.close();
      await transport.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it("prioritizes stop and cancels queued setpoints", async () => {
    vi.useFakeTimers();
    try {
      const transport = new MockFtmsTransport({ controlResponseDelayMs: 25 });
      await transport.connect();
      const queue = new ControlPointQueue(transport, 100);
      await queue.open();

      const active = queue.execute(targetPowerCommand(100), { coalesceKey: "setpoint" });
      await vi.advanceTimersByTimeAsync(0);
      const stale = queue.execute(targetPowerCommand(110), { coalesceKey: "setpoint" });
      const stop = queue.execute(stopCommand(), {
        cancelQueuedKeys: ["setpoint"],
        priority: "safety",
      });

      await expect(stale).rejects.toMatchObject({
        code: FTMS_ERROR_CODE.commandSuperseded,
      });
      await vi.advanceTimersByTimeAsync(25);
      await active;
      expect(transport.commandHistory).toEqual([0x05, 0x08]);
      await vi.advanceTimersByTimeAsync(25);
      await stop;
      expect(transport.commandHistory).toEqual([0x05, 0x08]);
      queue.close();
      await transport.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves a safety command ahead of normal queued commands", async () => {
    vi.useFakeTimers();
    try {
      const transport = new MockFtmsTransport({ controlResponseDelayMs: 25 });
      await transport.connect();
      const queue = new ControlPointQueue(transport, 100);
      await queue.open();

      const active = queue.execute(targetPowerCommand(100));
      await vi.advanceTimersByTimeAsync(0);
      const normal = queue.execute(targetPowerCommand(110));
      const stop = queue.execute(stopCommand(), { priority: "safety" });

      await vi.advanceTimersByTimeAsync(25);
      await active;
      expect(transport.commandHistory).toEqual([0x05, 0x08]);
      await vi.advanceTimersByTimeAsync(25);
      await stop;
      expect(transport.commandHistory).toEqual([0x05, 0x08, 0x05]);
      await vi.advanceTimersByTimeAsync(25);
      await normal;
      queue.close();
      await transport.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a queued opcode when an earlier matching command times out", async () => {
    vi.useFakeTimers();
    try {
      const transport = new MockFtmsTransport({ controlResponseDelayMs: 100 });
      await transport.connect();
      const queue = new ControlPointQueue(transport, 10);
      await queue.open();

      const active = queue.execute(targetPowerCommand(100));
      const queued = queue.execute(targetPowerCommand(110));
      const activeRejection = expect(active).rejects.toMatchObject({
        code: FTMS_ERROR_CODE.commandTimeout,
      });
      const queuedRejection = expect(queued).rejects.toMatchObject({
        code: FTMS_ERROR_CODE.commandDesynchronized,
      });

      await vi.advanceTimersByTimeAsync(10);
      await Promise.all([activeRejection, queuedRejection]);
      queue.close();
      await vi.runOnlyPendingTimersAsync();
      await transport.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });
});
