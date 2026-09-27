import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMockSensor,
  FitnessSensor,
  type Sensor,
  type SensorKind,
  type SensorTransport,
} from "@open-trainer/ftms/sensors";
import { SensorManager } from "./sensors";

afterEach(() => vi.useRealTimers());
describe("explicit sensor sources", () => {
  it("defaults to trainer power/cadence and no heart rate; pairing does not silently change it", async () => {
    vi.useFakeTimers();
    const manager = new SensorManager();
    const trainer = {
      instantaneousPowerWatts: 210,
      instantaneousCadenceRpm: 85,
      heartRateBpm: 120,
    };
    expect(manager.resolve(trainer)).toMatchObject({
      powerW: 210,
      cadenceRpm: 85,
      heartRateBpm: null,
    });
    await manager.connect("power", true);
    expect(manager.resolve(trainer).powerW).toBe(210);
    manager.selectSource("power", "external");
    expect(manager.resolve(trainer).powerW).toBe(185);
    manager.selectSource("heartRate", "trainer");
    expect(manager.resolve(trainer).heartRateBpm).toBe(120);
    manager.selectSource("cadence", "none");
    expect(manager.resolve(trainer).cadenceRpm).toBeNull();
    await manager.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not fall back on stale, disconnected, reconnecting, or absent external data", async () => {
    vi.useFakeTimers();
    let receive: ((value: DataView) => void) | undefined;
    let lost: (() => void) | undefined;
    const transport: SensorTransport = {
      connect: vi.fn(async (_kind, onValue, onDisconnect) => {
        receive = onValue;
        lost = onDisconnect;
        return { name: "Meter", batteryPercent: null };
      }),
      disconnect: vi.fn(async () => undefined),
    };
    const manager = new SensorManager(
      (kind) => new FitnessSensor(kind, transport, { staleAfterMs: 1000 }),
    );
    const trainer = { instantaneousPowerWatts: 250 };
    manager.selectSource("power", "external");
    expect(manager.resolve(trainer).powerW).toBeNull();
    await manager.connect("power");
    receive?.(new DataView(Uint8Array.of(0, 0, 190, 0).buffer));
    expect(manager.resolve(trainer).powerW).toBe(190);
    await vi.advanceTimersByTimeAsync(1000);
    expect(manager.resolve(trainer).powerW).toBeNull();
    receive?.(new DataView(Uint8Array.of(0, 0, 180, 0).buffer));
    lost?.();
    expect(manager.resolve(trainer).powerW).toBeNull();
    await manager.disconnect("power");
    expect(manager.state.current.sources.power).toBe("external");
    expect(manager.resolve(trainer).powerW).toBeNull();
    manager.selectSource("power", "trainer");
    expect(manager.resolve(trainer).powerW).toBe(250);
  });
  it("connects three independent kinds and resolves external measurements", async () => {
    vi.useFakeTimers();
    const factory = vi.fn((kind: SensorKind): Sensor => createMockSensor(kind));
    const manager = new SensorManager(factory);
    await Promise.all([
      manager.connect("power", true),
      manager.connect("cadence", true),
      manager.connect("heart-rate", true),
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    manager.selectSource("power", "external");
    manager.selectSource("cadence", "external");
    manager.selectSource("heartRate", "external");
    const values = manager.resolve({});
    expect(values.powerW).toBe(185);
    expect(values.cadenceRpm).toBeCloseTo(90, 0);
    expect(values.heartRateBpm).toBe(142);
    await manager.connect("power", true);
    expect(factory).toHaveBeenCalledTimes(3);
    expect(() => manager.connect("power", false)).toThrow("Disconnect");
    await manager.disconnect("power");
    await manager.disconnect("power");
    await manager.connect("power", false);
    await manager.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("publishes immutable current state and removes observers", () => {
    const manager = new SensorManager();
    const listener = vi.fn();
    const unsubscribe = manager.state.subscribe(listener);
    manager.selectSource("power", "none");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    manager.selectSource("power", "trainer");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(Object.isFrozen(manager.state.current.sources)).toBe(true);
    expect(manager.resolve({ instantaneousPowerWatts: NaN }).powerW).toBeNull();
  });
});

describe("sensor telemetry and provenance boundaries", () => {
  it("preserves trainer fields while removing intentionally missing measurements", async () => {
    vi.useFakeTimers();
    const manager = new SensorManager();
    const packet = {
      timestamp: 123,
      instantaneousPowerWatts: 200,
      instantaneousCadenceRpm: 85,
      heartRateBpm: 130,
      instantaneousSpeedKph: 30,
      totalDistanceMeters: 2500,
    };
    manager.selectSource("power", "external");
    expect(manager.applyToTelemetry(packet, false)).toEqual({
      timestamp: 123,
      instantaneousCadenceRpm: 85,
      instantaneousSpeedKph: 30,
      totalDistanceMeters: 2500,
    });
    await manager.connect("power", true);
    const demoPacket = manager.applyToTelemetry(packet, true);
    expect(demoPacket.instantaneousPowerWatts).toBe(185);
    expect(packet.instantaneousPowerWatts).toBe(200);
    await manager.dispose();
  });
  it("marks and suppresses selected external sources from a different simulation mode", async () => {
    vi.useFakeTimers();
    const manager = new SensorManager((_kind, _simulator) => createMockSensor("power"));
    await manager.connect("power", true);
    expect(manager.hasMixedSources(false)).toBe(false);
    manager.selectSource("power", "external");
    expect(manager.hasMixedSources(false)).toBe(true);
    expect(manager.hasMixedSources(true)).toBe(false);
    expect(
      manager.applyToTelemetry({ timestamp: 1, instantaneousPowerWatts: 250 }, false)
        .instantaneousPowerWatts,
    ).toBeUndefined();
    expect(manager.applyToTelemetry({ timestamp: 1 }, true).instantaneousPowerWatts).toBe(185);
    await manager.disconnect("power");
    await manager.connect("power", false);
    expect(manager.hasMixedSources(true)).toBe(true);
    expect(
      manager.applyToTelemetry({ timestamp: 1, instantaneousPowerWatts: 250 }, true)
        .instantaneousPowerWatts,
    ).toBeUndefined();
    await manager.dispose();
  });
  it("captures immutable explicit source and simulation provenance", async () => {
    vi.useFakeTimers();
    const manager = new SensorManager();
    manager.selectSource("heartRate", "external");
    expect(manager.sourceSnapshot(false)).toEqual({
      power: { source: "trainer", sensorName: null, simulator: false },
      cadence: { source: "trainer", sensorName: null, simulator: false },
      heartRate: { source: "external", sensorName: null, simulator: null },
    });
    await manager.connect("heart-rate", true);
    const snapshot = manager.sourceSnapshot(true);
    expect(snapshot.heartRate).toEqual({
      source: "external",
      sensorName: "Demo heart-rate sensor",
      simulator: true,
    });
    expect(Object.isFrozen(snapshot.heartRate)).toBe(true);
    manager.selectSource("heartRate", "none");
    expect(manager.sourceSnapshot(false).heartRate).toEqual({
      source: "none",
      sensorName: null,
      simulator: null,
    });
    expect(snapshot.heartRate.source).toBe("external");
    await manager.dispose();
  });
});
