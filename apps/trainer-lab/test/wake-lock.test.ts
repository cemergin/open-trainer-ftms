import type {
  keepScreenAwake as KeepScreenAwake,
  screenAwakeStatus as ScreenAwakeStatus,
} from "../src/services";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MockWakeLock extends EventTarget {
  release = vi.fn(async () => {
    this.dispatchEvent(new Event("release"));
  });
}

let request: ReturnType<typeof vi.fn>;
let keepScreenAwake: typeof KeepScreenAwake;
let screenAwakeStatus: typeof ScreenAwakeStatus;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  request = vi.fn();
  vi.stubGlobal("navigator", { wakeLock: { request } });
  vi.stubGlobal("document", { visibilityState: "visible" });
  ({ keepScreenAwake, screenAwakeStatus } = await import("../src/services"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("screen wake lock", () => {
  it("reacquires after the browser releases the current lock", async () => {
    const first = new MockWakeLock();
    const second = new MockWakeLock();
    request.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await keepScreenAwake(true);
    await keepScreenAwake(true);
    expect(request).toHaveBeenCalledTimes(1);

    first.dispatchEvent(new Event("release"));
    expect(screenAwakeStatus()).toBe("unavailable");
    vi.advanceTimersByTime(30_000);
    await keepScreenAwake(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith("screen");
    await keepScreenAwake(false);
    expect(second.release).toHaveBeenCalledOnce();
  });

  it("backs off frequent renders after denial and permits a later retry", async () => {
    const lock = new MockWakeLock();
    request.mockRejectedValueOnce(new Error("Power saving")).mockResolvedValueOnce(lock);
    await expect(keepScreenAwake(true)).resolves.toBeUndefined();
    expect(screenAwakeStatus()).toBe("unavailable");
    for (let index = 0; index < 100; index++) {
      vi.advanceTimersByTime(250);
      await keepScreenAwake(true);
    }
    expect(request).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    await keepScreenAwake(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(screenAwakeStatus()).toBe("active");
    await keepScreenAwake(false);
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it("keeps a pending request unique across pause and resume", async () => {
    let resolve!: (lock: MockWakeLock) => void;
    request.mockReturnValueOnce(
      new Promise<MockWakeLock>((done) => {
        resolve = done;
      }),
    );
    const pending = keepScreenAwake(true);
    expect(screenAwakeStatus()).toBe("requesting");
    await keepScreenAwake(true);
    await keepScreenAwake(false);
    expect(screenAwakeStatus()).toBe("inactive");
    await keepScreenAwake(true);
    expect(request).toHaveBeenCalledTimes(1);

    const lock = new MockWakeLock();
    resolve(lock);
    await pending;
    expect(lock.release).not.toHaveBeenCalled();
    await keepScreenAwake(false);
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it("releases a late lock when the ride has ended", async () => {
    let resolve!: (lock: MockWakeLock) => void;
    request.mockReturnValueOnce(
      new Promise<MockWakeLock>((done) => {
        resolve = done;
      }),
    );
    const pending = keepScreenAwake(true);
    await keepScreenAwake(false);
    const lock = new MockWakeLock();
    resolve(lock);
    await pending;
    expect(lock.release).toHaveBeenCalledOnce();

    request.mockResolvedValueOnce(new MockWakeLock());
    await keepScreenAwake(true);
    expect(request).toHaveBeenCalledTimes(2);
    await keepScreenAwake(false);
  });

  it("does not let a delayed release event clear a newer lock", async () => {
    const first = new MockWakeLock();
    first.release.mockResolvedValue(undefined);
    const second = new MockWakeLock();
    request.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await keepScreenAwake(true);
    await keepScreenAwake(false);
    await keepScreenAwake(true);
    first.dispatchEvent(new Event("release"));
    await keepScreenAwake(true);
    expect(request).toHaveBeenCalledTimes(2);
    await keepScreenAwake(false);
    expect(second.release).toHaveBeenCalledOnce();
  });

  it("waits for the page to become visible before requesting a lock", async () => {
    vi.stubGlobal("document", { visibilityState: "hidden" });
    await keepScreenAwake(true);
    expect(screenAwakeStatus()).toBe("unavailable");
    expect(request).not.toHaveBeenCalled();
    vi.stubGlobal("document", { visibilityState: "visible" });
    request.mockResolvedValueOnce(new MockWakeLock());
    await keepScreenAwake(true);
    expect(request).toHaveBeenCalledOnce();
    await keepScreenAwake(false);
  });

  it("retries immediately after returning to the visible page", async () => {
    request
      .mockRejectedValueOnce(new Error("Hidden page"))
      .mockResolvedValueOnce(new MockWakeLock());
    await keepScreenAwake(true);
    vi.stubGlobal("document", { visibilityState: "hidden" });
    await keepScreenAwake(true);
    vi.stubGlobal("document", { visibilityState: "visible" });
    await keepScreenAwake(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(screenAwakeStatus()).toBe("active");
  });

  it("allows a new ride to retry and reports unsupported browsers", async () => {
    request.mockRejectedValueOnce(new Error("Denied")).mockResolvedValueOnce(new MockWakeLock());
    await keepScreenAwake(true);
    await keepScreenAwake(false);
    await keepScreenAwake(true);
    expect(request).toHaveBeenCalledTimes(2);
    await keepScreenAwake(false);
    vi.stubGlobal("navigator", {});
    await keepScreenAwake(true);
    expect(screenAwakeStatus()).toBe("unavailable");
  });

  it("releases a pending lock when the page becomes hidden", async () => {
    let resolve!: (lock: MockWakeLock) => void;
    request.mockReturnValueOnce(
      new Promise<MockWakeLock>((done) => {
        resolve = done;
      }),
    );
    const pending = keepScreenAwake(true);
    vi.stubGlobal("document", { visibilityState: "hidden" });
    await keepScreenAwake(true);
    const lock = new MockWakeLock();
    resolve(lock);
    await pending;
    expect(lock.release).toHaveBeenCalledOnce();
    expect(screenAwakeStatus()).toBe("unavailable");
  });
});
