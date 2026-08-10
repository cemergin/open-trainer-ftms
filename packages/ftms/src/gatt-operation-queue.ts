import { FTMS_ERROR_CODE, FtmsStateError } from "./errors.js";

export class AsyncOperationQueue {
  #tail: Promise<void> = Promise.resolve();
  #closedReason: string | undefined;
  #generation = 0;

  run<T>(operation: () => Promise<T>): Promise<T> {
    const generation = this.#generation;
    const result = this.#tail.then(async () => {
      if (this.#closedReason || generation !== this.#generation) {
        throw new FtmsStateError(
          this.#closedReason ?? "Bluetooth operation belongs to a previous connection.",
          FTMS_ERROR_CODE.operationClosed,
        );
      }
      return operation();
    });
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  close(reason = "Bluetooth operation queue closed."): void {
    this.#closedReason = reason;
    this.#generation += 1;
  }

  reopen(): void {
    this.#closedReason = undefined;
  }
}
