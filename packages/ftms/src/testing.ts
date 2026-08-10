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
