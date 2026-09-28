import { afterEach, describe, expect, it, vi } from "vitest";
import { FtmsProtocolError, FtmsRangeError } from "../src/errors.js";
import { FaultInjectionFtmsTransport } from "../src/fault-transport.js";
import { MockFtmsTransport } from "../src/mock-transport.js";
import { FtmsTrainer } from "../src/trainer.js";
import {
  RecordingFtmsTransport,
  ReplayFtmsTransport,
  parseTransportTrace,
  type TransportTrace,
} from "../src/trace-transport.js";
import { FTMS_UUIDS } from "../src/uuids.js";

const basicTrace: TransportTrace = {
  version: 1,
  truncated: false,
  events: [
    { kind: "connect", atMs: 0, session: 1 },
    { kind: "subscribe", characteristic: 1, atMs: 1, session: 1 },
    { kind: "write", characteristic: 1, bytes: [7], atMs: 2, session: 1 },
    { kind: "notification", characteristic: 1, bytes: [8], atMs: 12, session: 1 },
    { kind: "unsubscribe", characteristic: 1, atMs: 13, session: 1 },
    { kind: "disconnect-request", atMs: 14, session: 1 },
    { kind: "disconnect", atMs: 14, session: 1 },
  ],
};

afterEach(() => vi.useRealTimers());

describe("protocol recording and deterministic replay", () => {
  it("replays real trainer reads, writes, responses and two sessions without hardware", async () => {
    vi.useFakeTimers();
    const mock = new MockFtmsTransport();
    const recording = new RecordingFtmsTransport(mock);
    expect(recording.deviceName).toBe(mock.deviceName);
    const trainer = new FtmsTrainer(recording);
    for (let session = 0; session < 2; session += 1) {
      await trainer.connect();
      await trainer.acquireControl();
      await trainer.start();
      await trainer.setTargetPower(200);
      await trainer.disconnect();
    }
    const captured = recording.trace;
    expect(captured.truncated).toBe(false);
    expect(
      captured.events.filter((event) => event.kind === "connect").map((event) => event.session),
    ).toEqual([1, 2]);
    expect(JSON.stringify(captured)).not.toContain(mock.deviceName);
    const replay = new ReplayFtmsTransport(captured);
    const player = new FtmsTrainer(replay);
    for (let session = 0; session < 2; session += 1) {
      await player.connect();
      for (const command of [
        () => player.acquireControl(),
        () => player.start(),
        () => player.setTargetPower(200),
      ]) {
        const pending = command();
        await vi.runAllTimersAsync();
        await pending;
      }
      await player.disconnect();
    }
    replay.assertComplete();
    expect(replay.remainingEvents).toBe(0);
    expect(replay.deviceName).toBe("Recorded FTMS session");
    await replay.disconnect();
  });
  it("enforces command bytes without advancing on mismatch", async () => {
    vi.useFakeTimers();
    const replay = new ReplayFtmsTransport(basicTrace);
    await replay.connect();
    const values: number[] = [];
    const unsubscribe = await replay.subscribe(1, (value) => values.push(value.getUint8(0)));
    await expect(replay.write(2, Uint8Array.of(7))).rejects.toThrow(FtmsProtocolError);
    await expect(replay.write(1, Uint8Array.of(6))).rejects.toThrow(FtmsProtocolError);
    await expect(replay.write(1, Uint8Array.of(7, 0))).rejects.toThrow(FtmsProtocolError);
    expect(() => replay.assertComplete()).toThrow("unconsumed");
    await replay.write(1, Uint8Array.of(7));
    await vi.advanceTimersByTimeAsync(9);
    expect(values).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(values).toEqual([8]);
    unsubscribe();
    unsubscribe();
    await replay.disconnect();
    replay.assertComplete();
    await expect(replay.read(1)).rejects.toThrow("end of trace");
  });
  it("copies traces, preserves subviews and bounds capture by entries or bytes", async () => {
    const mock = new MockFtmsTransport();
    const recording = new RecordingFtmsTransport(mock, { maxEvents: 2 });
    await recording.connect();
    const unsubscribe = await recording.subscribe(9, () => undefined);
    mock.emitNotification(9, Uint8Array.of(1));
    expect(recording.trace.truncated).toBe(true);
    expect(recording.trace.events).toHaveLength(2);
    unsubscribe();
    unsubscribe();
    await recording.disconnect();
    await recording.disconnect();
    expect(() => new ReplayFtmsTransport(recording.trace)).toThrow("truncated");
    const recordingBytes = new RecordingFtmsTransport(mock, { maxBytes: 8 });
    await recordingBytes.connect();
    await recordingBytes.read(FTMS_UUIDS.feature);
    const snapshot = recordingBytes.trace;
    const event = snapshot.events[1];
    if (event && "bytes" in event) (event.bytes as number[])[0] = 255;
    expect(recordingBytes.trace).not.toEqual(snapshot);
    await recordingBytes.read(FTMS_UUIDS.feature);
    expect(recordingBytes.trace.truncated).toBe(true);
    await recordingBytes.disconnect();
    expect(() => new RecordingFtmsTransport(mock, { maxBytes: 0 })).toThrow(FtmsRangeError);
    expect(() => new RecordingFtmsTransport(mock, { maxEvents: Infinity })).toThrow(FtmsRangeError);
    await mock.connect();
    await expect(new RecordingFtmsTransport(mock).connect()).rejects.toThrow("before connecting");
    await mock.disconnect();
  });
  it("captures and replays unsolicited disconnects, and cancels pending replay timers", async () => {
    vi.useFakeTimers();
    const mock = new MockFtmsTransport();
    const recording = new RecordingFtmsTransport(mock);
    const listener = vi.fn();
    recording.onDisconnect(listener);
    await recording.connect();
    await mock.disconnect();
    expect(listener).toHaveBeenCalledOnce();
    const replay = new ReplayFtmsTransport(recording.trace);
    const lost = vi.fn();
    replay.onDisconnect(lost);
    await replay.connect();
    await vi.runAllTimersAsync();
    expect(lost).toHaveBeenCalledOnce();
    expect(replay.isConnected).toBe(false);
    replay.assertComplete();
    const abandoned = new ReplayFtmsTransport(basicTrace);
    await abandoned.connect();
    await abandoned.subscribe(1, listener);
    await abandoned.write(1, Uint8Array.of(7));
    abandoned.dispose();
    await vi.runAllTimersAsync();
    expect(listener).toHaveBeenCalledOnce();
  });
  it("marks incomplete failed write/subscribe recordings as truncated", async () => {
    const mock = new MockFtmsTransport();
    const recording = new RecordingFtmsTransport(mock);
    await recording.connect();
    await expect(recording.write(4, Uint8Array.of(1))).rejects.toThrow();
    expect(recording.trace.truncated).toBe(true);
    await recording.disconnect();
    const second = new RecordingFtmsTransport(mock);
    await second.connect();
    vi.spyOn(mock, "subscribe").mockRejectedValueOnce(new Error("failed"));
    await expect(second.subscribe(4, () => undefined)).rejects.toThrow();
    expect(second.trace.truncated).toBe(true);
    await second.disconnect();
  });
  it("strictly validates imported trace structure and sanitizes extra metadata", () => {
    const invalid = [
      null,
      1,
      {},
      { version: 2, truncated: false, events: [] },
      { version: 1, truncated: false, events: [null] },
      { ...basicTrace, events: [{ kind: "connect", atMs: -1, session: 1 }] },
      { ...basicTrace, events: [{ kind: "connect", atMs: Infinity, session: 1 }] },
      { ...basicTrace, events: [{ kind: "connect", atMs: 86_400_001, session: 1 }] },
      {
        ...basicTrace,
        events: [{ kind: "read", atMs: 0, session: 0, characteristic: 1, bytes: [] }],
      },
      { ...basicTrace, events: [{ kind: "connect", atMs: 0, session: 2 }] },
      { ...basicTrace, events: [basicTrace.events[0], { kind: "connect", atMs: 1, session: 2 }] },
      { ...basicTrace, events: [basicTrace.events[0], { kind: "other", atMs: 1, session: 1 }] },
      {
        ...basicTrace,
        events: [
          basicTrace.events[0],
          { kind: "read", atMs: 1, session: 1, characteristic: -1, bytes: [] },
        ],
      },
      {
        ...basicTrace,
        events: [
          basicTrace.events[0],
          { kind: "read", atMs: 1, session: 1, characteristic: 1, bytes: [256] },
        ],
      },
      {
        ...basicTrace,
        events: [
          basicTrace.events[0],
          { kind: "read", atMs: 1, session: 1, characteristic: 1, bytes: null },
        ],
      },
    ];
    for (const input of invalid)
      expect(() => parseTransportTrace(input)).toThrow(FtmsProtocolError);
    expect(parseTransportTrace({ ...basicTrace, deviceName: "private" })).toEqual(basicTrace);
  });
});

describe("explicit fault injection", () => {
  it("replaces reads/writes and selects a one-shot occurrence", async () => {
    const mock = new MockFtmsTransport();
    const faults = new FaultInjectionFtmsTransport(mock, [
      { operation: "read", characteristic: FTMS_UUIDS.feature, action: "replace", bytes: [1] },
      {
        operation: "write",
        characteristic: FTMS_UUIDS.controlPoint,
        opcode: 7,
        occurrence: 2,
        action: "replace",
        bytes: [0],
      },
    ]);
    expect(faults.deviceName).toBe(mock.deviceName);
    await faults.connect();
    await faults.connect();
    expect((await faults.read(FTMS_UUIDS.feature)).byteLength).toBe(1);
    expect((await faults.read(FTMS_UUIDS.feature)).byteLength).toBe(8);
    await faults.write(FTMS_UUIDS.controlPoint, Uint8Array.of(7));
    await faults.write(FTMS_UUIDS.controlPoint, Uint8Array.of(7));
    expect(mock.commandHistory).toEqual([7, 0]);
    await faults.disconnect();
  });
  it("drops/replaces/delays notifications without delivering after unsubscribe", async () => {
    vi.useFakeTimers();
    const mock = new MockFtmsTransport();
    const faults = new FaultInjectionFtmsTransport(mock, [
      { operation: "notification", opcode: 1, action: "drop" },
      { operation: "notification", opcode: 2, action: "replace", bytes: [20] },
      { operation: "notification", opcode: 3, action: "delay", delayMs: 10 },
      { operation: "notification", opcode: 4, action: "reject" },
    ]);
    await faults.connect();
    const received: number[] = [];
    const unsubscribe = await faults.subscribe(1, (value) => received.push(value.getUint8(0)));
    for (const opcode of [1, 2, 3, 4, 5]) mock.emitNotification(1, Uint8Array.of(opcode));
    await Promise.resolve();
    expect(received).toEqual([5, 20]);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(10);
    expect(received).toEqual([5, 20]);
    await faults.disconnect();
  });
  it("injects failed writes, delayed writes, disconnects and clears delayed promises", async () => {
    vi.useFakeTimers();
    const mock = new MockFtmsTransport();
    const faults = new FaultInjectionFtmsTransport(mock, [
      { operation: "write", opcode: 1, action: "reject" },
      { operation: "write", opcode: 7, action: "delay", delayMs: 5 },
      { operation: "write", opcode: 8, action: "delay", delayMs: 50 },
      { operation: "read", action: "disconnect" },
    ]);
    const disconnected = vi.fn();
    faults.onDisconnect(disconnected);
    await faults.connect();
    await expect(faults.write(FTMS_UUIDS.controlPoint, Uint8Array.of(1))).rejects.toThrow(
      "Injected",
    );
    const delayed = faults.write(FTMS_UUIDS.controlPoint, Uint8Array.of(7));
    await vi.advanceTimersByTimeAsync(5);
    await delayed;
    expect(mock.commandHistory).toEqual([7]);
    const cancelled = expect(
      faults.write(FTMS_UUIDS.controlPoint, Uint8Array.of(8)),
    ).rejects.toThrow("cancelled");
    await expect(faults.read(FTMS_UUIDS.feature)).rejects.toThrow("Injected disconnect");
    await cancelled;
    expect(disconnected).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects invalid occurrence, delay and replacement values", () => {
    const mock = new MockFtmsTransport();
    expect(
      () =>
        new FaultInjectionFtmsTransport(mock, [
          { operation: "read", action: "reject", occurrence: 0 },
        ]),
    ).toThrow(FtmsRangeError);
    expect(
      () =>
        new FaultInjectionFtmsTransport(mock, [
          { operation: "read", action: "delay", delayMs: -1 },
        ]),
    ).toThrow(FtmsRangeError);
    expect(
      () =>
        new FaultInjectionFtmsTransport(mock, [
          { operation: "read", action: "replace", bytes: [256] },
        ]),
    ).toThrow(FtmsRangeError);
  });
});

describe("replay and fault ordering regressions", () => {
  it("delivers intervening notifications before matching the next subscribe/read operation", async () => {
    vi.useFakeTimers();
    const replay = new ReplayFtmsTransport({
      version: 1,
      truncated: false,
      events: [
        { kind: "connect", atMs: 0, session: 1 },
        { kind: "subscribe", atMs: 0, session: 1, characteristic: 1 },
        { kind: "notification", atMs: 1, session: 1, characteristic: 1, bytes: [42] },
        { kind: "subscribe", atMs: 2, session: 1, characteristic: 2 },
        { kind: "notification", atMs: 3, session: 1, characteristic: 2, bytes: [43] },
        { kind: "read", atMs: 4, session: 1, characteristic: 3, bytes: [44] },
        { kind: "notification", atMs: 5, session: 1, characteristic: 1, bytes: [45] },
        { kind: "unsubscribe", atMs: 6, session: 1, characteristic: 1 },
        { kind: "unsubscribe", atMs: 6, session: 1, characteristic: 2 },
        { kind: "disconnect-request", atMs: 7, session: 1 },
        { kind: "disconnect", atMs: 7, session: 1 },
      ],
    });
    await replay.connect();
    const first = vi.fn(),
      second = vi.fn();
    const offFirst = await replay.subscribe(1, first);
    const subscribing = replay.subscribe(2, second);
    await vi.advanceTimersByTimeAsync(1);
    const offSecond = await subscribing;
    const reading = replay.read(3);
    await vi.advanceTimersByTimeAsync(1);
    expect((await reading).getUint8(0)).toBe(44);
    offFirst();
    offSecond();
    const disconnecting = replay.disconnect();
    await vi.runAllTimersAsync();
    await disconnecting;
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    replay.assertComplete();
  });
  it("counts all matching fault occurrences even when an earlier rule fires", async () => {
    const mock = new MockFtmsTransport();
    const faults = new FaultInjectionFtmsTransport(mock, [
      { operation: "write", opcode: 0, occurrence: 1, action: "reject" },
      { operation: "write", opcode: 0, occurrence: 2, action: "disconnect" },
    ]);
    await faults.connect();
    await expect(faults.write(FTMS_UUIDS.controlPoint, Uint8Array.of(0))).rejects.toThrow(
      "Injected transport failure",
    );
    await expect(faults.write(FTMS_UUIDS.controlPoint, Uint8Array.of(0))).rejects.toThrow(
      "Injected disconnect",
    );
    expect(faults.isConnected).toBe(false);
    expect(mock.commandHistory).toEqual([]);
  });
  it("multiplexes subscriptions without duplicating captured/replayed packets", async () => {
    vi.useFakeTimers();
    const mock = new MockFtmsTransport();
    const recording = new RecordingFtmsTransport(mock);
    await recording.connect();
    const first = vi.fn(),
      second = vi.fn();
    const offFirst = await recording.subscribe(1, first);
    const offSecond = await recording.subscribe(1, second);
    mock.emitNotification(1, Uint8Array.of(42));
    offFirst();
    offSecond();
    await recording.disconnect();
    expect(recording.capturedEventCount).toBe(6);
    expect(recording.isTruncated).toBe(false);
    const replay = new ReplayFtmsTransport(recording.trace);
    await replay.connect();
    const offA = await replay.subscribe(1, first);
    const subscribed = replay.subscribe(1, second);
    await vi.runAllTimersAsync();
    const offB = await subscribed;
    offA();
    offB();
    await replay.disconnect();
    replay.assertComplete();
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
  });
});

it("disposal prevents an awaited replay operation from restarting timers", async () => {
  vi.useFakeTimers();
  const replay = new ReplayFtmsTransport(basicTrace);
  await replay.connect();
  await replay.subscribe(1, () => undefined);
  const writing = expect(replay.write(1, Uint8Array.of(7))).rejects.toThrow("disposed");
  replay.dispose();
  await writing;
  expect(replay.isConnected).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
