import {
  FTMS_ERROR_CODE,
  FtmsCommandSupersededError,
  FtmsProtocolError,
  FtmsStateError,
  FtmsTimeoutError,
  normalizeFtmsError,
} from "./errors.js";
import { parseControlPointResponse } from "./parsers.js";
import { EventSource } from "./reactive.js";
import type { ControlPointResponse, FtmsTransport, Unsubscribe } from "./types.js";
import { FTMS_UUIDS } from "./uuids.js";

export interface ControlPointExecutionOptions {
  readonly priority?: "normal" | "safety";
  readonly coalesceKey?: string;
  readonly cancelQueuedKeys?: readonly string[];
}

interface QueuedCommand {
  readonly command: Uint8Array;
  readonly opcode: number;
  readonly priority: "normal" | "safety";
  readonly coalesceKey: string | undefined;
  readonly resolve: (response: ControlPointResponse) => void;
  readonly reject: (error: Error) => void;
}

interface PendingCommand extends QueuedCommand {
  timer: ReturnType<typeof setTimeout>;
}

export class ControlPointQueue {
  readonly #responseSource = new EventSource<ControlPointResponse>();
  readonly #errorSource = new EventSource<Error>();
  readonly responses = this.#responseSource.asReadonly();
  readonly errors = this.#errorSource.asReadonly();

  readonly #queued: QueuedCommand[] = [];
  readonly #desynchronizedOpcodes = new Set<number>();
  #pending: PendingCommand | undefined;
  #unsubscribe: Unsubscribe | undefined;
  #openPromise: Promise<void> | undefined;
  #closed = true;

  constructor(
    private readonly transport: FtmsTransport,
    private readonly timeoutMs: number,
  ) {}

  async open(): Promise<void> {
    if (this.#unsubscribe) return;
    if (this.#openPromise) return this.#openPromise;
    const operation = this.#open();
    this.#openPromise = operation;
    try {
      await operation;
    } finally {
      if (this.#openPromise === operation) this.#openPromise = undefined;
    }
  }

  async #open(): Promise<void> {
    this.#closed = false;
    this.#desynchronizedOpcodes.clear();
    try {
      this.#unsubscribe = await this.transport.subscribe(FTMS_UUIDS.controlPoint, (value) => {
        this.#handleResponse(value);
      });
    } catch (error) {
      this.#closed = true;
      throw normalizeFtmsError(
        error,
        "Subscribing to the FTMS control point failed.",
        FTMS_ERROR_CODE.transportFailure,
      );
    }
  }

  execute(
    command: Uint8Array,
    options: ControlPointExecutionOptions = {},
  ): Promise<ControlPointResponse> {
    const payload = command.slice();
    const opcode = payload[0];
    if (opcode === undefined) {
      return Promise.reject(new FtmsProtocolError("FTMS commands cannot be empty."));
    }
    if (this.#closed) {
      return Promise.reject(
        new FtmsStateError(
          "Cannot send a command through a closed control point.",
          FTMS_ERROR_CODE.operationClosed,
        ),
      );
    }
    if (this.#desynchronizedOpcodes.has(opcode)) {
      return Promise.reject(
        new FtmsStateError(
          `FTMS command 0x${opcode.toString(16)} is waiting for a late response after timing out. Reconnect if the trainer does not respond.`,
          FTMS_ERROR_CODE.commandDesynchronized,
          { details: { opcode } },
        ),
      );
    }

    return new Promise<ControlPointResponse>((resolve, reject) => {
      const cancelKeys = new Set(options.cancelQueuedKeys ?? []);
      if (cancelKeys.size > 0) {
        this.#rejectQueued(
          (entry) => entry.coalesceKey !== undefined && cancelKeys.has(entry.coalesceKey),
        );
      }
      if (options.coalesceKey) {
        this.#rejectQueued((entry) => entry.coalesceKey === options.coalesceKey);
      }

      const entry: QueuedCommand = {
        command: payload,
        opcode,
        priority: options.priority ?? "normal",
        coalesceKey: options.coalesceKey,
        resolve,
        reject,
      };
      if (entry.priority === "safety") {
        const firstNormal = this.#queued.findIndex((queued) => queued.priority === "normal");
        if (firstNormal === -1) this.#queued.push(entry);
        else this.#queued.splice(firstNormal, 0, entry);
      } else {
        this.#queued.push(entry);
      }
      this.#pump();
    });
  }

  close(reason = "Control point closed."): void {
    this.#closed = true;
    const unsubscribe = this.#unsubscribe;
    this.#unsubscribe = undefined;
    try {
      unsubscribe?.();
    } catch (error) {
      this.#errorSource.emit(
        normalizeFtmsError(error, "Unsubscribing from the control point failed."),
      );
    }
    this.#desynchronizedOpcodes.clear();
    const closedError = new FtmsStateError(reason, FTMS_ERROR_CODE.operationClosed);
    if (this.#pending) {
      clearTimeout(this.#pending.timer);
      this.#pending.reject(closedError);
      this.#pending = undefined;
    }
    for (const queued of this.#queued.splice(0)) queued.reject(closedError);
  }

  #rejectQueued(predicate: (entry: QueuedCommand) => boolean): void {
    for (let index = this.#queued.length - 1; index >= 0; index -= 1) {
      const entry = this.#queued[index];
      if (!entry || !predicate(entry)) continue;
      this.#queued.splice(index, 1);
      entry.reject(
        new FtmsCommandSupersededError("FTMS command was superseded before it was sent.", {
          details: { opcode: entry.opcode },
        }),
      );
    }
  }

  #pump(): void {
    if (this.#closed || this.#pending) return;
    const entry = this.#queued.shift();
    if (!entry) return;
    if (this.#desynchronizedOpcodes.has(entry.opcode)) {
      entry.reject(
        new FtmsStateError(
          `FTMS command 0x${entry.opcode.toString(16)} is waiting for a late response after timing out.`,
          FTMS_ERROR_CODE.commandDesynchronized,
          { details: { opcode: entry.opcode } },
        ),
      );
      this.#pump();
      return;
    }

    const pending: PendingCommand = {
      ...entry,
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
    };
    pending.timer = setTimeout(() => {
      if (this.#pending !== pending) return;
      this.#pending = undefined;
      this.#desynchronizedOpcodes.add(entry.opcode);
      entry.reject(
        new FtmsTimeoutError(`FTMS command 0x${entry.opcode.toString(16)} timed out.`, {
          details: { opcode: entry.opcode, timeoutMs: this.timeoutMs },
        }),
      );
      this.#pump();
    }, this.timeoutMs);
    this.#pending = pending;
    void this.transport.write(FTMS_UUIDS.controlPoint, entry.command).catch((error: unknown) => {
      if (this.#pending !== pending) return;
      this.#pending = undefined;
      clearTimeout(pending.timer);
      entry.reject(
        normalizeFtmsError(
          error,
          "Writing the FTMS control command failed.",
          FTMS_ERROR_CODE.transportFailure,
        ),
      );
      this.#pump();
    });
  }

  #handleResponse(value: DataView): void {
    let response: ControlPointResponse;
    try {
      response = parseControlPointResponse(value);
    } catch (error) {
      this.#errorSource.emit(
        error instanceof FtmsProtocolError
          ? error
          : new FtmsProtocolError("Invalid Fitness Machine Control Point response.", {
              cause: error,
            }),
      );
      return;
    }

    this.#responseSource.emit(response);
    if (this.#desynchronizedOpcodes.delete(response.requestOpcode)) {
      this.#pump();
      return;
    }
    if (!this.#pending || this.#pending.opcode !== response.requestOpcode) return;

    const pending = this.#pending;
    this.#pending = undefined;
    clearTimeout(pending.timer);
    pending.resolve(response);
    this.#pump();
  }
}
