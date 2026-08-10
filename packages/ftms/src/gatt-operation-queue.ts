import { FtmsError } from "./errors.js";

export class AsyncOperationQueue {
  #tail: Promise<void> = Promise.resolve();
  #closedReason: string | undefined;

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(async () => {
      if (this.#closedReason) throw new FtmsError(this.#closedReason);
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
  }

  reopen(): void {
    this.#closedReason = undefined;
  }
}
