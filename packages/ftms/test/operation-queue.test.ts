import { describe, expect, it } from "vitest";
import { AsyncOperationQueue } from "../src/gatt-operation-queue.js";
import { FTMS_ERROR_CODE } from "../src/errors.js";

describe("AsyncOperationQueue", () => {
  it("does not overlap operations", async () => {
    const queue = new AsyncOperationQueue();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;

    const first = queue.run(async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push("first:end");
      return 1;
    });
    const second = queue.run(async () => {
      order.push("second:start");
      order.push("second:end");
      return 2;
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    releaseFirst?.();

    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("continues after a failed operation", async () => {
    const queue = new AsyncOperationQueue();
    const first = queue.run(async () => {
      throw new Error("expected failure");
    });
    const second = queue.run(async () => 2);

    await expect(first).rejects.toThrow("expected failure");
    await expect(second).resolves.toBe(2);
  });

  it("never revives stale operations when a closed queue is reopened", async () => {
    const queue = new AsyncOperationQueue();
    let release: (() => void) | undefined;
    const first = queue.run(
      () =>
        new Promise<number>((resolve) => {
          release = () => resolve(1);
        }),
    );
    const stale = queue.run(async () => 2);
    await Promise.resolve();

    queue.close("disconnected");
    queue.reopen();
    const current = queue.run(async () => 3);
    release?.();

    await expect(first).resolves.toBe(1);
    await expect(stale).rejects.toMatchObject({ code: FTMS_ERROR_CODE.operationClosed });
    await expect(current).resolves.toBe(3);
  });
});
