import { describe, expect, it } from "vitest";
import { AsyncOperationQueue } from "../src/gatt-operation-queue.js";

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
});
