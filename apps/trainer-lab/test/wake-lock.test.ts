import type { keepScreenAwake as KeepScreenAwake } from "../src/services";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MockWakeLock extends EventTarget {
  release = vi.fn(async () => {
    this.dispatchEvent(new Event("release"));
  });
}

let request: ReturnType<typeof vi.fn>;
let keepScreenAwake: typeof KeepScreenAwake;

beforeEach(async () => {
  vi.resetModules();
  request = vi.fn();
  vi.stubGlobal("navigator", { wakeLock: { request } });
  vi.stubGlobal("document", { visibilityState: "visible" });
  ({ keepScreenAwake } = await import("../src/services"));
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    await keepScreenAwake(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith("screen");
    await keepScreenAwake(false);
    expect(second.release).toHaveBeenCalledOnce();
  });

  it("allows a later retry after the browser rejects a request", async () => {
    const lock = new MockWakeLock();
    request.mockRejectedValueOnce(new Error("Power saving")).mockResolvedValueOnce(lock);
    await expect(keepScreenAwake(true)).resolves.toBeUndefined();
    await keepScreenAwake(true);
    expect(request).toHaveBeenCalledTimes(2);
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
    await keepScreenAwake(true);
    await keepScreenAwake(false);
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
    expect(request).not.toHaveBeenCalled();
    vi.stubGlobal("document", { visibilityState: "visible" });
    request.mockResolvedValueOnce(new MockWakeLock());
    await keepScreenAwake(true);
    expect(request).toHaveBeenCalledOnce();
    await keepScreenAwake(false);
  });
});
