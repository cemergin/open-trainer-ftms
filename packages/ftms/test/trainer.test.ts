import { describe, expect, it, vi } from "vitest";
import {
  FTMS_ERROR_CODE,
  FtmsControlError,
  FtmsRangeError,
  type FtmsTransport,
  type MachineStatus,
  type TrainerTelemetry,
  type Unsubscribe,
} from "../src/index.js";
import { createMockTrainer, MockFtmsTransport } from "../src/testing.js";
import { createTrainer } from "../src/transport.js";
import { FTMS_UUIDS } from "../src/uuids.js";

class SelectiveFailureTransport implements FtmsTransport {
  constructor(
    readonly inner: MockFtmsTransport,
    private readonly failures: {
      read?: number;
      subscribe?: number;
      disconnect?: boolean;
      unsubscribe?: boolean;
      featureBits?: { machine: number; target: number };
    } = {},
  ) {}

  get isConnected(): boolean {
    return this.inner.isConnected;
  }

  get deviceName(): string | undefined {
    return this.inner.deviceName;
  }

  connect(): Promise<void> {
    return this.inner.connect();
  }

  disconnect(): Promise<void> {
    if (this.failures.disconnect) return Promise.reject(new Error("disconnect failed"));
    return this.inner.disconnect();
  }

  read(characteristic: number): Promise<DataView> {
    if (characteristic === this.failures.read) return Promise.reject(new Error("read failed"));
    if (characteristic === FTMS_UUIDS.feature && this.failures.featureBits) {
      const bytes = new Uint8Array(8);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, this.failures.featureBits.machine, true);
      view.setUint32(4, this.failures.featureBits.target, true);
      return Promise.resolve(view);
    }
    return this.inner.read(characteristic);
  }

  write(characteristic: number, value: Uint8Array): Promise<void> {
    return this.inner.write(characteristic, value);
  }

  subscribe(characteristic: number, listener: (value: DataView) => void): Promise<Unsubscribe> {
    if (characteristic === this.failures.subscribe) {
      return Promise.reject(new Error("subscribe failed"));
    }
    return this.inner.subscribe(characteristic, listener).then((unsubscribe) => {
      if (!this.failures.unsubscribe) return unsubscribe;
      return () => {
        unsubscribe();
        throw new Error("unsubscribe failed");
      };
    });
  }

  onDisconnect(listener: () => void): Unsubscribe {
    return this.inner.onDisconnect(listener);
  }
}

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

  it("shares concurrent connection attempts and installs one subscription set", async () => {
    const transport = new MockFtmsTransport();
    const trainer = createTrainer(transport);

    const [first, second] = await Promise.all([trainer.connect(), trainer.connect()]);

    expect(first).toEqual(second);
    expect(transport.connectCount).toBe(1);
    expect(transport.subscriptionCount(0x2ad9)).toBe(1);
    expect(transport.subscriptionCount(0x2ad2)).toBe(1);
    expect(transport.subscriptionCount(0x2ada)).toBe(1);
    await trainer.disconnect();
  });

  it("turns machine-status notifications into typed state transitions", async () => {
    const transport = new MockFtmsTransport();
    const trainer = createTrainer(transport);
    const statuses: MachineStatus[] = [];
    trainer.machineStatusEvents.subscribe((status) => statuses.push(status));
    await trainer.connect();
    await trainer.acquireControl();
    await trainer.start();
    expect(trainer.activity.current).toBe("running");

    transport.loseControl();

    expect(statuses.at(-1)).toMatchObject({ opcode: 0xff, kind: "control-permission-lost" });
    expect(trainer.control.current).toBe("revoked");
    expect(trainer.activity.current).toBe("idle");
    await trainer.disconnect();
  });

  it("supports the complete controlled-session lifecycle", async () => {
    const transport = new MockFtmsTransport();
    const trainer = createTrainer(transport);
    await trainer.connect();
    await trainer.acquireControl();

    await expect(trainer.setTargetPower(200.5)).rejects.toBeInstanceOf(FtmsRangeError);
    await expect(trainer.setTargetPower(2_000)).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.valueOutOfRange,
    });
    await trainer.setResistanceLevel(10);
    await trainer.setSimulation({ gradePercent: 3 });
    await trainer.start();
    await trainer.pause();
    expect(trainer.activity.current).toBe("paused");
    await trainer.reset();

    expect(trainer.control.current).toBe("unavailable");
    expect(trainer.activity.current).toBe("idle");
    expect(transport.commandHistory).toEqual([0x00, 0x04, 0x11, 0x07, 0x08, 0x01]);
    await trainer.disconnect();
  });

  it("supports explicitly configured legacy FTMS 1.0 resistance encoding", async () => {
    const transport = new MockFtmsTransport({ resistanceControlFormat: "uint8" });
    const trainer = createTrainer(transport, { resistanceControlFormat: "uint8" });
    await trainer.connect();
    await trainer.acquireControl();

    await expect(trainer.setResistanceLevel(12.5)).resolves.toMatchObject({
      requestOpcode: 0x04,
    });
    await trainer.disconnect();
  });

  it("fails closed when an advertised mandatory range cannot be read", async () => {
    const transport = new SelectiveFailureTransport(new MockFtmsTransport(), {
      read: FTMS_UUIDS.supportedPowerRange,
    });
    const trainer = createTrainer(transport);

    await expect(trainer.connect()).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.transportFailure,
    });

    expect(trainer.connection.current).toBe("error");
    expect(transport.isConnected).toBe(false);
    expect(trainer.capabilities.current).toBeNull();
  });

  it("offers an explicit lenient mode for non-conformant devices", async () => {
    const transport = new SelectiveFailureTransport(new MockFtmsTransport(), {
      read: FTMS_UUIDS.supportedPowerRange,
    });
    const trainer = createTrainer(transport, { strictProtocol: false });
    const errors: Error[] = [];
    trainer.errors.subscribe((error) => errors.push(error));

    const capabilities = await trainer.connect();

    expect(capabilities.supportsPowerTarget).toBe(true);
    expect(capabilities.powerRange).toBeUndefined();
    expect(errors).toHaveLength(1);
    await trainer.disconnect();
  });

  it("requires Machine Status when control is exposed in strict mode", async () => {
    const transport = new SelectiveFailureTransport(new MockFtmsTransport(), {
      subscribe: FTMS_UUIDS.machineStatus,
    });
    const trainer = createTrainer(transport);

    await expect(trainer.connect()).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.transportFailure,
    });
    expect(transport.isConnected).toBe(false);
  });

  it("clears live state after an unexpected transport disconnect", async () => {
    const transport = new MockFtmsTransport();
    const trainer = createTrainer(transport);
    await trainer.connect();
    await trainer.acquireControl();
    await trainer.start();

    await transport.disconnect();

    expect(trainer.connection.current).toBe("disconnected");
    expect(trainer.control.current).toBe("unavailable");
    expect(trainer.activity.current).toBe("idle");
    expect(trainer.capabilities.current).toBeNull();
    expect(trainer.telemetry.current).toBeNull();
  });

  it("routes subscriber exceptions to the trainer error stream", () => {
    const trainer = createMockTrainer();
    const errors: Error[] = [];
    trainer.errors.subscribe((error) => errors.push(error));

    trainer.connection.subscribe(() => {
      throw new Error("consumer failed");
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: FTMS_ERROR_CODE.unknown });
  });

  it("guards unavailable capabilities and supports telemetry opt-out", async () => {
    const transport = new SelectiveFailureTransport(new MockFtmsTransport(), {
      featureBits: { machine: 0, target: 0 },
    });
    const trainer = createTrainer(transport, { autoStartTelemetry: false });

    await expect(trainer.setTargetPower(100)).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.notConnected,
    });
    await trainer.connect();

    await expect(trainer.setTargetPower(100)).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.unsupportedCapability,
    });
    await expect(trainer.setResistanceLevel(5)).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.unsupportedCapability,
    });
    await expect(trainer.setSimulation({ gradePercent: 1 })).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.unsupportedCapability,
    });
    expect(transport.inner.subscriptionCount(FTMS_UUIDS.indoorBikeData)).toBe(0);
    await trainer.disconnect();
  });

  it("surfaces malformed telemetry and status without corrupting state", async () => {
    const transport = new MockFtmsTransport();
    const trainer = createTrainer(transport);
    const errors: Error[] = [];
    const rawStatuses: Uint8Array[] = [];
    trainer.errors.subscribe((error) => errors.push(error));
    trainer.machineStatus.subscribe((status) => rawStatuses.push(status));
    await trainer.connect();

    transport.emitNotification(FTMS_UUIDS.indoorBikeData, new Uint8Array());
    transport.emitNotification(FTMS_UUIDS.machineStatus, Uint8Array.of(0x02));
    transport.emitNotification(FTMS_UUIDS.machineStatus, Uint8Array.of(0x7e));

    expect(errors).toHaveLength(2);
    expect(rawStatuses).toEqual([Uint8Array.of(0x02), Uint8Array.of(0x7e)]);
    expect(trainer.connection.current).toBe("ready");
    await trainer.disconnect();
  });

  it("keeps Machine Status optional only in explicit lenient mode", async () => {
    const transport = new SelectiveFailureTransport(new MockFtmsTransport(), {
      subscribe: FTMS_UUIDS.machineStatus,
    });
    const trainer = createTrainer(transport, { strictProtocol: false });
    const errors: Error[] = [];
    trainer.errors.subscribe((error) => errors.push(error));

    await trainer.connect();

    expect(trainer.connection.current).toBe("ready");
    expect(errors).toHaveLength(1);
    await trainer.disconnect();
  });

  it("resets stopping state and emits the failure when stop is rejected", async () => {
    const trainer = createMockTrainer();
    const errors: Error[] = [];
    trainer.errors.subscribe((error) => errors.push(error));
    await trainer.connect();

    await expect(trainer.stop()).rejects.toBeInstanceOf(FtmsControlError);

    expect(trainer.activity.current).toBe("idle");
    expect(errors).toHaveLength(1);
    await trainer.disconnect();
  });

  it("makes cached connect and concurrent disconnect calls idempotent", async () => {
    const transport = new MockFtmsTransport();
    const trainer = createTrainer(transport);
    const first = await trainer.connect();

    await expect(trainer.connect()).resolves.toBe(first);
    await Promise.all([trainer.disconnect(), trainer.disconnect()]);

    expect(transport.connectCount).toBe(1);
    expect(trainer.connection.current).toBe("disconnected");
  });

  it("reaches disconnected state and reports a transport disconnect failure", async () => {
    const transport = new SelectiveFailureTransport(new MockFtmsTransport(), {
      disconnect: true,
    });
    const trainer = createTrainer(transport);
    const errors: Error[] = [];
    trainer.errors.subscribe((error) => errors.push(error));
    await trainer.connect();

    await expect(trainer.disconnect()).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.transportFailure,
    });

    expect(trainer.connection.current).toBe("disconnected");
    expect(errors).toHaveLength(1);
    await transport.inner.disconnect();
  });

  it("isolates transport unsubscribe failures during cleanup", async () => {
    const transport = new SelectiveFailureTransport(new MockFtmsTransport(), {
      unsubscribe: true,
    });
    const trainer = createTrainer(transport);
    const errors: Error[] = [];
    trainer.errors.subscribe((error) => errors.push(error));
    await trainer.connect();

    await trainer.disconnect();

    expect(errors.length).toBeGreaterThan(0);
    expect(trainer.connection.current).toBe("disconnected");
  });

  it("lets stop overtake and cancel queued setpoints", async () => {
    vi.useFakeTimers();
    try {
      const transport = new MockFtmsTransport({ controlResponseDelayMs: 25 });
      const trainer = createTrainer(transport, { commandTimeoutMs: 100 });
      await trainer.connect();
      const acquire = trainer.acquireControl();
      await vi.advanceTimersByTimeAsync(25);
      await acquire;

      const active = trainer.setTargetPower(100);
      const queued = trainer.setTargetPower(110);
      const queuedRejection = expect(queued).rejects.toMatchObject({
        code: FTMS_ERROR_CODE.commandSuperseded,
      });
      const stop = trainer.stop();

      await queuedRejection;
      await vi.advanceTimersByTimeAsync(25);
      await active;
      expect(transport.commandHistory).toEqual([0x00, 0x05, 0x08]);
      await vi.advanceTimersByTimeAsync(25);
      await stop;
      expect(trainer.activity.current).toBe("idle");
      await trainer.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });
});
