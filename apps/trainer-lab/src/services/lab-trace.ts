import { FtmsControlError, type ResistanceControlFormat, type Trainer } from "@open-trainer/ftms";
import { createTrainer } from "@open-trainer/ftms/transport";
import { WebBluetoothFtmsTransport } from "@open-trainer/ftms/web-bluetooth";
import {
  FaultInjectionFtmsTransport,
  MockFtmsTransport,
  RecordingFtmsTransport,
  ReplayFtmsTransport,
  parseTransportTrace,
  type TransportFault,
  type TransportTrace,
} from "@open-trainer/ftms/testing";

export const LAB_TRACE_BYTE_LIMIT = 4_000_000;
export type LabFault =
  "none" | "delay-response" | "drop-response" | "reject-power" | "disconnect-power";

function faultsFor(mode: LabFault): TransportFault[] {
  switch (mode) {
    case "none":
      return [];
    case "delay-response":
      return [
        { operation: "notification", characteristic: 0x2ad9, action: "delay", delayMs: 1500 },
      ];
    case "drop-response":
      return [{ operation: "notification", characteristic: 0x2ad9, action: "drop" }];
    case "reject-power":
      return [{ operation: "write", characteristic: 0x2ad9, opcode: 0x05, action: "reject" }];
    case "disconnect-power":
      return [{ operation: "write", characteristic: 0x2ad9, opcode: 0x05, action: "disconnect" }];
  }
}

export interface LabConnection {
  readonly trainer: Trainer;
  readonly recording: RecordingFtmsTransport;
}

export function createLabConnection(
  simulator: boolean,
  resistanceControlFormat: ResistanceControlFormat,
  fault: LabFault,
): LabConnection {
  const source = simulator
    ? new MockFtmsTransport({
        resistanceControlFormat,
        supportsTargetCadence: true,
        supportsSpindown: true,
      })
    : new WebBluetoothFtmsTransport();
  const transport =
    simulator && fault !== "none"
      ? new FaultInjectionFtmsTransport(source, faultsFor(fault))
      : source;
  const recording = new RecordingFtmsTransport(transport, { maxEvents: 10_000, maxBytes: 500_000 });
  return { trainer: createTrainer(recording, { resistanceControlFormat }), recording };
}

function commandFor(bytes: readonly number[]): (trainer: Trainer) => Promise<unknown> {
  const data = Uint8Array.from(bytes);
  const view = new DataView(data.buffer);
  const length = (expected: number): void => {
    if (bytes.length !== expected)
      throw new Error("The trace contains a malformed control command.");
  };
  switch (bytes[0]) {
    case 0:
      length(1);
      return (trainer) => trainer.acquireControl();
    case 1:
      length(1);
      return (trainer) => trainer.reset();
    case 4: {
      if (bytes.length !== 2 && bytes.length !== 3) length(3);
      const level = bytes.length === 2 ? view.getUint8(1) / 10 : view.getInt16(1, true) / 10;
      return (trainer) => trainer.setResistanceLevel(level);
    }
    case 5:
      length(3);
      return (trainer) => trainer.setTargetPower(view.getInt16(1, true));
    case 7:
      length(1);
      return (trainer) => trainer.start();
    case 8:
      length(2);
      if (bytes[1] === 1) return (trainer) => trainer.stop();
      if (bytes[1] === 2) return (trainer) => trainer.pause();
      throw new Error("The trace contains an unsupported stop/pause control.");
    case 0x11:
      length(7);
      return (trainer) =>
        trainer.setSimulation({
          windSpeedMps: view.getInt16(1, true) / 1000,
          gradePercent: view.getInt16(3, true) / 100,
          rollingResistance: view.getUint8(5) / 10000,
          windResistanceKgPerM: view.getUint8(6) / 100,
        });
    case 0x13:
      length(2);
      if (bytes[1] !== 1 && bytes[1] !== 2)
        throw new Error("The trace contains an unsupported spin-down control.");
      return (trainer) => trainer.spinDown(bytes[1] === 1 ? "start" : "ignore");
    case 0x14:
      length(3);
      return (trainer) => trainer.setTargetCadence(view.getUint16(1, true) / 2);
    case undefined:
      throw new Error("The trace contains an empty control command.");
    default:
      throw new Error("The trace contains a control command this Lab cannot replay.");
  }
}

function requireCompleteTrace(trace: TransportTrace): void {
  if (trace.truncated)
    throw new Error("This recording is incomplete. Replay requires a complete trace.");
  if (!trace.events.length) throw new Error("The trace contains no connection.");
  if (trace.events.at(-1)?.kind !== "disconnect")
    throw new Error("This recording is incomplete. Disconnect before exporting a replay trace.");
}

export function parseLabTrace(json: string): TransportTrace {
  if (new TextEncoder().encode(json).byteLength > LAB_TRACE_BYTE_LIMIT)
    throw new Error("Trace exceeds the 4 MB import limit.");
  const trace = parseTransportTrace(JSON.parse(json) as unknown);
  requireCompleteTrace(trace);
  for (const event of trace.events) {
    if (event.kind !== "write") continue;
    if (event.characteristic !== 0x2ad9)
      throw new Error("Lab replay accepts FTMS control-point writes only.");
    commandFor(event.bytes);
  }
  return trace;
}

export class LabReplay {
  readonly trainer: Trainer;
  readonly #transport: ReplayFtmsTransport;
  #stopped = false;

  constructor(trace: TransportTrace) {
    requireCompleteTrace(trace);
    this.#transport = new ReplayFtmsTransport(trace);
    const legacy = trace.events.some(
      (event) => event.kind === "write" && event.bytes[0] === 4 && event.bytes.length === 2,
    );
    this.trainer = createTrainer(this.#transport, {
      resistanceControlFormat: legacy ? "uint8" : "sint16",
    });
  }

  get isStopped(): boolean {
    return this.#stopped;
  }

  get remainingEvents(): number {
    return this.#transport.remainingEvents;
  }

  async play(onRejected: (message: string) => void): Promise<void> {
    try {
      while (!this.isStopped) {
        await this.#transport.drain();
        if (this.#stopped) return;
        const event = this.#transport.nextEvent;
        if (!event) {
          this.#transport.assertComplete();
          return;
        }
        if (event.kind === "connect") await this.trainer.connect();
        else if (event.kind === "write") {
          try {
            await commandFor(event.bytes)(this.trainer);
          } catch (error) {
            if (error instanceof FtmsControlError) onRejected(error.message);
            else throw error;
          }
        } else if (event.kind === "unsubscribe" || event.kind === "disconnect-request")
          await this.trainer.disconnect();
        else
          throw new Error(
            `Replay cannot continue at ${event.kind}. Import a Trainer Lab recording.`,
          );
      }
    } catch (error) {
      if (!this.#stopped) throw error;
    } finally {
      this.#transport.dispose();
      await this.trainer.disconnect();
    }
  }

  stop(): void {
    this.#stopped = true;
    this.#transport.dispose();
  }
}

export async function readLabTraceFile(file: File): Promise<TransportTrace> {
  if (file.size > LAB_TRACE_BYTE_LIMIT) throw new Error("Trace exceeds the 4 MB import limit.");
  return parseLabTrace(await file.text());
}
