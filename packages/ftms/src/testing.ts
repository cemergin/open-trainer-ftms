import { MockFtmsTransport, type MockFtmsTransportOptions } from "./mock-transport.js";
import { FtmsTrainer } from "./trainer.js";
import type { TrainerOptions } from "./types.js";

export { MockFtmsTransport, type MockFtmsTransportOptions } from "./mock-transport.js";

export function createMockTrainer(
  transportOptions: MockFtmsTransportOptions = {},
  trainerOptions: TrainerOptions = {},
): FtmsTrainer {
  return new FtmsTrainer(new MockFtmsTransport(transportOptions), trainerOptions);
}

export {
  RecordingFtmsTransport,
  ReplayFtmsTransport,
  parseTransportTrace,
  type RecordingOptions,
  type TransportTrace,
  type TransportTraceEvent,
} from "./trace-transport.js";
export { FaultInjectionFtmsTransport, type TransportFault } from "./fault-transport.js";
