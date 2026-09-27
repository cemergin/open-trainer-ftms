import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLabConnection,
  LabReplay,
  parseLabTrace,
  readLabTraceFile,
} from "../src/services/lab-trace";
const trace = (events: object[]): string =>
  JSON.stringify({ version: 1, truncated: false, events });
const connect = { kind: "connect", atMs: 0, session: 1 };
const write = (bytes: number[], characteristic = 0x2ad9): object => ({
  kind: "write",
  atMs: 1,
  session: 1,
  characteristic,
  bytes,
});
afterEach(() => vi.useRealTimers());

describe("Lab offline session tools", () => {
  it("records and automatically replays the full Lab command surface", async () => {
    vi.useFakeTimers();
    const session = createLabConnection(true, "sint16", "none");
    const trainer = session.trainer;
    await trainer.connect();
    await trainer.acquireControl();
    await trainer.setTargetPower(80);
    await trainer.setTargetCadence(85.5);
    await trainer.setResistanceLevel(5);
    await trainer.setSimulation({ gradePercent: -2 });
    await trainer.start();
    await trainer.pause();
    await trainer.spinDown("start");
    await trainer.spinDown("ignore");
    await trainer.stop();
    await trainer.reset();
    await trainer.disconnect();
    const replay = new LabReplay(parseLabTrace(JSON.stringify(session.recording.trace)));
    const errors = vi.fn();
    const playback = replay.play(errors);
    await vi.runAllTimersAsync();
    await playback;
    expect(replay.remainingEvents).toBe(0);
    expect(replay.trainer.connection.current).toBe("disconnected");
    expect(errors).not.toHaveBeenCalled();
  });
  it("replays rejected commands and legacy resistance", async () => {
    vi.useFakeTimers();
    const session = createLabConnection(true, "uint8", "none");
    await session.trainer.connect();
    await expect(session.trainer.start()).rejects.toThrow();
    await session.trainer.acquireControl();
    await session.trainer.setResistanceLevel(5);
    await session.trainer.disconnect();
    const replay = new LabReplay(session.recording.trace);
    const rejected = vi.fn();
    const playback = replay.play(rejected);
    await vi.runAllTimersAsync();
    await playback;
    expect(rejected).toHaveBeenCalledOnce();
    expect(replay.remainingEvents).toBe(0);
  });
  it("applies each fault selector and bounds import", async () => {
    vi.useFakeTimers();
    for (const fault of [
      "delay-response",
      "drop-response",
      "reject-power",
      "disconnect-power",
    ] as const) {
      const session = createLabConnection(true, "sint16", fault);
      await session.trainer.connect();
      const control = session.trainer.acquireControl().catch(() => undefined);
      await vi.advanceTimersByTimeAsync(4000);
      await control;
      if (fault === "reject-power" || fault === "disconnect-power")
        await expect(session.trainer.setTargetPower(80)).rejects.toThrow();
      await session.trainer.disconnect();
    }
    expect(() => parseLabTrace(" ".repeat(4_000_001))).toThrow("4 MB");
    await expect(readLabTraceFile({ size: 4_000_001 } as File)).rejects.toThrow("4 MB");
    await expect(
      readLabTraceFile({ size: 1, text: async () => trace([connect]) } as File),
    ).resolves.toMatchObject({ version: 1 });
  });
  it("validates commands before replay", () => {
    for (const bytes of [[0, 1], [4], [8, 3], [0x13, 3], [0x40]])
      expect(() => parseLabTrace(trace([connect, write(bytes)]))).toThrow();
    expect(() => parseLabTrace(trace([connect, write([0], 1)]))).toThrow("control-point");
    expect(() => parseLabTrace(trace([]))).toThrow("no connection");
    expect(() =>
      parseLabTrace(JSON.stringify({ version: 1, truncated: true, events: [] })),
    ).toThrow("incomplete");
    for (const bytes of [
      [0],
      [1],
      [4, 50],
      [4, 50, 0],
      [5, 80, 0],
      [7],
      [8, 1],
      [8, 2],
      [0x11, 0, 0, 0, 0, 40, 51],
      [0x13, 1],
      [0x13, 2],
      [0x14, 170, 0],
    ])
      expect(parseLabTrace(trace([connect, write(bytes)])).events).toHaveLength(2);
  });
  it("stops playback and releases pending commands", async () => {
    vi.useFakeTimers();
    const session = createLabConnection(true, "sint16", "none");
    await session.trainer.connect();
    await session.trainer.acquireControl();
    await session.trainer.start();
    await session.trainer.disconnect();
    const replay = new LabReplay(session.recording.trace);
    const playback = replay.play(() => undefined);
    await Promise.resolve();
    replay.stop();
    await vi.runAllTimersAsync();
    await playback;
    expect(replay.trainer.connection.current).toBe("disconnected");
    expect(replay.remainingEvents).toBeGreaterThan(0);
  });
});
