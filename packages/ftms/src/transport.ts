import { FtmsTrainer } from "./trainer.js";
import type { FtmsTransport, TrainerOptions } from "./types.js";

export { FtmsTrainer } from "./trainer.js";
export type { FtmsTransport, TrainerOptions } from "./types.js";

export function createTrainer(transport: FtmsTransport, options: TrainerOptions = {}): FtmsTrainer {
  return new FtmsTrainer(transport, options);
}
