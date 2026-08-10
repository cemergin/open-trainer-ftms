import { FtmsError, FtmsProtocolError } from "./errors.js";
import { parseControlPointResponse } from "./parsers.js";
import { EventSource } from "./reactive.js";
import type { ControlPointResponse, FtmsTransport, Unsubscribe } from "./types.js";
import { FTMS_UUIDS } from "./uuids.js";

interface PendingCommand {
  opcode: number;
  resolve: (response: ControlPointResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ControlPointQueue {
  readonly #responseSource = new EventSource<ControlPointResponse>();
  readonly responses = this.#responseSource.asReadonly();

  #tail: Promise<void> = Promise.resolve();
  #pending: PendingCommand | undefined;
  #unsubscribe: Unsubscribe | undefined;
  #closed = false;

  constructor(
    private readonly transport: FtmsTransport,
    private readonly timeoutMs: number,
  ) {}

  async open(): Promise<void> {
    if (this.#unsubscribe) return;
    this.#closed = false;
    this.#unsubscribe = await this.transport.subscribe(FTMS_UUIDS.controlPoint, (value) => {
      this.#handleResponse(value);
    });
  }

  execute(command: Uint8Array): Promise<ControlPointResponse> {
    const operation = this.#tail.then(() => this.#perform(command));
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  close(reason = "Control point closed."): void {
    this.#closed = true;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    if (this.#pending) {
      clearTimeout(this.#pending.timer);
      this.#pending.reject(new FtmsError(reason));
      this.#pending = undefined;
    }
  }

  async #perform(command: Uint8Array): Promise<ControlPointResponse> {
    if (this.#closed) throw new FtmsError("Cannot send a command through a closed control point.");
    const opcode = command[0];
    if (opcode === undefined) throw new FtmsProtocolError("FTMS commands cannot be empty.");

    return new Promise<ControlPointResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#pending?.opcode === opcode) this.#pending = undefined;
        reject(new FtmsError(`FTMS command 0x${opcode.toString(16)} timed out.`));
      }, this.timeoutMs);

      this.#pending = { opcode, resolve, reject, timer };
      void this.transport.write(FTMS_UUIDS.controlPoint, command).catch((error: unknown) => {
        if (this.#pending?.opcode === opcode) this.#pending = undefined;
        clearTimeout(timer);
        reject(error instanceof Error ? error : new FtmsError(String(error)));
      });
    });
  }

  #handleResponse(value: DataView): void {
    let response: ControlPointResponse;
    try {
      response = parseControlPointResponse(value);
    } catch {
      return;
    }

    this.#responseSource.emit(response);
    if (!this.#pending || this.#pending.opcode !== response.requestOpcode) return;

    const pending = this.#pending;
    this.#pending = undefined;
    clearTimeout(pending.timer);
    pending.resolve(response);
  }
}
