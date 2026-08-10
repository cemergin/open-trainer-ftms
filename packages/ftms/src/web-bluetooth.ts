import { FtmsTrainer } from "./trainer.js";
import type { TrainerOptions } from "./types.js";
import {
  WebBluetoothFtmsTransport,
  type WebBluetoothTransportOptions,
} from "./web-bluetooth-transport.js";

export {
  WebBluetoothFtmsTransport,
  type WebBluetoothTransportOptions,
} from "./web-bluetooth-transport.js";

export function createWebBluetoothTrainer(
  transportOptions: WebBluetoothTransportOptions = {},
  trainerOptions: TrainerOptions = {},
): FtmsTrainer {
  return new FtmsTrainer(new WebBluetoothFtmsTransport(transportOptions), trainerOptions);
}
