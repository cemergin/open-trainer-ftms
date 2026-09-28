import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CrankCadence,
  createMockSensor,
  createWebBluetoothSensor,
  FitnessSensor,
  parseCadence,
  parseCyclingPower,
  parseHeartRate,
  type SensorTransport,
} from "../src/sensors.js";

function bytes(...values: number[]): DataView {
  return new DataView(Uint8Array.from(values).buffer);
}
function crank(revolutions: number, eventTime: number): DataView {
  const packet = bytes(2, 0, 0, 0, 0);
  packet.setUint16(1, revolutions, true);
  packet.setUint16(3, eventTime, true);
  return packet;
}
function fakeTransport(): {
  transport: SensorTransport;
  receive: (value: DataView) => void;
  lose: () => void;
} {
  const callbacks = { receive: (_value: DataView): void => undefined, lose: (): void => undefined };
  const transport: SensorTransport = {
    connect: vi.fn(async (_kind, receive, lose) => {
      callbacks.receive = receive;
      callbacks.lose = lose;
      return { name: "Test sensor", batteryPercent: 70 };
    }),
    disconnect: vi.fn(async () => undefined),
  };
  return { transport, receive: (value) => callbacks.receive(value), lose: () => callbacks.lose() };
}

afterEach(() => vi.useRealTimers());
describe("SIG sensor measurement parsing", () => {
  it("reads 8/16 bit heart rate, optional energy and RR intervals, and contact loss", () => {
    expect(parseHeartRate(bytes(0, 142))).toBe(142);
    expect(parseHeartRate(bytes(1, 44, 1))).toBe(300);
    expect(parseHeartRate(bytes(0x1f, 44, 1, 5, 0, 0, 4, 0, 4))).toBe(300);
    expect(parseHeartRate(bytes(4, 150))).toBeNull();
  });
  it.each([[], [1], [1, 2], [8, 2], [16, 142], [16, 142, 1], [0, 142, 0], [32, 142]])(
    "rejects malformed heart rate %j",
    (...value) => {
      expect(() => parseHeartRate(bytes(...value))).toThrow();
    },
  );
  it("supports crank only, combined wheel/crank, and wheel-only CSC packets", () => {
    expect(parseCadence(crank(400, 1024))).toEqual({ revolutions: 400, eventTime: 1024 });
    expect(parseCadence(bytes(3, 0, 0, 0, 0, 0, 0, 5, 0, 0, 4))).toEqual({
      revolutions: 5,
      eventTime: 1024,
    });
    expect(parseCadence(bytes(1, 0, 0, 0, 0, 0, 0))).toBeNull();
  });
  it.each([[], [0], [4], [2, 0], [1, 0], [2, 1, 0, 2, 0, 0]])(
    "rejects malformed CSC %j",
    (...value) => {
      expect(() => parseCadence(bytes(...value))).toThrow();
    },
  );
  it("reads signed power and validates every optional field length", () => {
    expect(parseCyclingPower(bytes(0, 0, 246, 255))).toBe(-10);
    expect(parseCyclingPower(bytes(10, 16, 200, 0))).toBe(200);
    for (const [bit, size] of [
      [0, 1],
      [2, 2],
      [4, 6],
      [5, 4],
      [6, 4],
      [7, 4],
      [8, 3],
      [9, 2],
      [10, 2],
      [11, 2],
    ] as const) {
      const packet = new DataView(new ArrayBuffer(4 + size));
      packet.setUint16(0, 1 << bit, true);
      packet.setInt16(2, 321, true);
      expect(parseCyclingPower(packet)).toBe(321);
      expect(() =>
        parseCyclingPower(new DataView(packet.buffer, 0, packet.byteLength - 1)),
      ).toThrow();
    }
  });
  it("distinguishes wheel data at bit 4 from the payload-free offset indicator at bit 12", () => {
    expect(parseCyclingPower(bytes(0x10, 0x00, 0x41, 0x01, 1, 0, 0, 0, 0, 8))).toBe(321);
    expect(() => parseCyclingPower(bytes(0x10, 0x00, 0x41, 0x01))).toThrow();
    expect(parseCyclingPower(bytes(0x00, 0x10, 0x41, 0x01))).toBe(321);
    expect(() => parseCyclingPower(bytes(0x00, 0x10, 0x41, 0x01, 1, 0, 0, 0, 0, 8))).toThrow();
  });
  it("accepts a literal packet with balance, torque, wheel/crank data, energy and metadata flags", () => {
    // GSS section 3.75: 0x183f carries 15 payload octets after flags and power.
    const packet = bytes(
      0x3f,
      0x18,
      0x41,
      0x01,
      100, // Pedal balance, left reference.
      0x20,
      0, // Accumulated torque, crank source.
      1,
      0,
      0,
      0,
      0,
      8, // Wheel revolutions and event time.
      2,
      0,
      0,
      4, // Crank revolutions and event time.
      0x64,
      0, // Accumulated energy; the offset indicator adds no bytes.
    );
    expect(parseCyclingPower(packet)).toBe(321);
    expect(() =>
      parseCyclingPower(new DataView(packet.buffer, 0, packet.byteLength - 1)),
    ).toThrow();
  });
  it("accepts literal force/torque packets with packed extreme angles and both dead spots", () => {
    // GSS section 3.75: bit 6 or 7, then bits 8–10, carry 4 + 3 + 2 + 2 octets.
    for (const packet of [
      bytes(0x40, 0x07, 0x41, 0x01, 200, 0, 0x38, 0xff, 0x5a, 0xe0, 0x10, 0, 0, 180, 0),
      bytes(0x80, 0x07, 0x41, 0x01, 0x40, 0x06, 0xc0, 0xf9, 0x5a, 0xe0, 0x10, 0, 0, 180, 0),
    ]) {
      expect(parseCyclingPower(packet)).toBe(321);
      expect(() =>
        parseCyclingPower(new DataView(packet.buffer, 0, packet.byteLength - 1)),
      ).toThrow();
    }
  });
  it.each([[], [0, 0], [0, 0, 1], [0, 32, 0, 0], [0, 0, 0, 0, 0]])(
    "rejects invalid power %j",
    (...value) => {
      expect(() => parseCyclingPower(bytes(...value))).toThrow();
    },
  );
  it("handles cadence rollover, repeat notifications, stopped cranks and resets", () => {
    const cadence = new CrankCadence();
    expect(cadence.update({ revolutions: 65535, eventTime: 65000 }, 0)).toBeNull();
    expect(cadence.update({ revolutions: 0, eventTime: 488 }, 1000)).toBe(60);
    expect(cadence.update({ revolutions: 0, eventTime: 488 }, 2000)).toBe(60);
    expect(cadence.update({ revolutions: 0, eventTime: 488 }, 4000)).toBe(0);
    expect(cadence.update({ revolutions: 1, eventTime: 488 }, 5000)).toBeNull();
    expect(cadence.update({ revolutions: 2, eventTime: 1512 }, 6000)).toBe(60);
    expect(cadence.update({ revolutions: 2, eventTime: 1512 }, 70000)).toBeNull();
    expect(cadence.update({ revolutions: 2, eventTime: 1512 }, 65000)).toBeNull();
    cadence.reset();
    expect(cadence.update({ revolutions: 8, eventTime: 1 }, 66000)).toBeNull();
    expect(cadence.update({ revolutions: 0, eventTime: 2 }, 67000)).toBeNull();
  });
});

describe("sensor lifecycle and freshness", () => {
  it("provides readonly observations, expires silently absent/malformed data and cleans up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const fake = fakeTransport();
    const sensor = new FitnessSensor("heart-rate", fake.transport, { staleAfterMs: 1000 });
    const listener = vi.fn();
    const unsubscribe = sensor.telemetry.subscribe(listener);
    expect(sensor.state.current.status).toBe("disconnected");
    await Promise.all([sensor.connect(), sensor.connect()]);
    await sensor.connect();
    expect(vi.spyOn(fake.transport, "connect")).toHaveBeenCalledTimes(1);
    expect(sensor.state.current).toEqual({ status: "connected", name: "Test sensor", error: null });
    fake.receive(bytes(0, 145));
    expect(sensor.telemetry.current).toEqual({
      value: 145,
      updatedAt: 1000,
      fresh: true,
      batteryPercent: 70,
    });
    expect(Object.isFrozen(sensor.telemetry.current)).toBe(true);
    await vi.advanceTimersByTimeAsync(900);
    fake.receive(bytes(0));
    await vi.advanceTimersByTimeAsync(100);
    expect(sensor.telemetry.current).toMatchObject({ value: null, fresh: false, updatedAt: 1000 });
    fake.receive(bytes(6, 150));
    expect(sensor.telemetry.current.value).toBe(150);
    fake.receive(bytes(4, 150));
    expect(sensor.telemetry.current.fresh).toBe(false);
    await sensor.disconnect();
    fake.receive(bytes(0, 190));
    fake.lose();
    expect(sensor.telemetry.current.value).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    unsubscribe();
  });
  it("clears telemetry on unexpected disconnect and ignores late callbacks", async () => {
    const fake = fakeTransport();
    const sensor = new FitnessSensor("power", fake.transport);
    await sensor.connect();
    fake.receive(bytes(0, 0, 200, 0));
    fake.lose();
    expect(sensor.state.current.status).toBe("disconnected");
    fake.receive(bytes(0, 0, 200, 0));
    expect(sensor.telemetry.current.value).toBeNull();
    await sensor.connect();
    fake.receive(bytes(0, 0, 201, 0));
    expect(sensor.telemetry.current.value).toBe(201);
    await sensor.disconnect();
  });
  it("uses crank deltas and resets the baseline after notification loss", async () => {
    vi.useFakeTimers();
    const fake = fakeTransport();
    const sensor = new FitnessSensor("cadence", fake.transport);
    await sensor.connect();
    fake.receive(crank(10, 10));
    fake.receive(crank(11, 1034));
    expect(sensor.telemetry.current.value).toBe(60);
    fake.receive(bytes(1, 0, 0, 0, 0, 0, 0));
    expect(sensor.telemetry.current.value).toBe(60);
    await vi.advanceTimersByTimeAsync(5000);
    fake.receive(crank(30, 30000));
    expect(sensor.telemetry.current.value).toBeNull();
    await sensor.disconnect();
  });
  it("reports pairing failure and supports retry", async () => {
    const fake = fakeTransport();
    vi.spyOn(fake.transport, "connect").mockRejectedValueOnce(new Error("Denied"));
    const sensor = new FitnessSensor("power", fake.transport);
    await expect(sensor.connect()).rejects.toThrow("Denied");
    expect(sensor.state.current.error).toBe("Denied");
    await sensor.connect();
    await sensor.disconnect();
    vi.spyOn(fake.transport, "connect").mockRejectedValueOnce("failure");
    await expect(sensor.connect()).rejects.toBe("failure");
    expect(sensor.state.current.error).toBe("Sensor connection failed.");
  });
  it("disconnect during pending discovery cannot revive sensor state", async () => {
    const fake = fakeTransport();
    let finish: ((details: { name: string; batteryPercent: null }) => void) | undefined;
    vi.spyOn(fake.transport, "connect").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const sensor = new FitnessSensor("power", fake.transport);
    const pending = sensor.connect();
    await sensor.disconnect();
    finish?.({ name: "Late", batteryPercent: null });
    await pending;
    expect(sensor.state.current.status).toBe("disconnected");
  });
  it("late connection failure preserves explicit disconnected state", async () => {
    const fake = fakeTransport();
    let reject: ((error: Error) => void) | undefined;
    vi.spyOn(fake.transport, "connect").mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const sensor = new FitnessSensor("power", fake.transport);
    const pending = sensor.connect();
    const result = expect(pending).rejects.toThrow("Late failure");
    await sensor.disconnect();
    reject?.(new Error("Late failure"));
    await result;
    expect(sensor.state.current.status).toBe("disconnected");
  });
  it.each([0, -1, Infinity, NaN])("rejects invalid expiry %s", (staleAfterMs) => {
    expect(() => new FitnessSensor("power", fakeTransport().transport, { staleAfterMs })).toThrow();
  });
  it.each(["heart-rate", "power", "cadence"] as const)(
    "simulates %s with deterministic notifications and teardown",
    async (kind) => {
      vi.useFakeTimers();
      const sensor = createMockSensor(kind, { now: () => 100 });
      await sensor.connect();
      await vi.advanceTimersByTimeAsync(1000);
      expect(sensor.telemetry.current.value).not.toBeNull();
      expect(sensor.state.current.name).toContain("Demo");
      await sensor.disconnect();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("creates a Bluetooth-backed sensor without accessing the browser until connect", () => {
    const sensor = createWebBluetoothSensor("power");
    expect(sensor.kind).toBe("power");
  });
});
