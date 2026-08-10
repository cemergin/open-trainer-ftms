import { mapState, type Trainer } from "@open-trainer/ftms";
import { targetPowerCommand } from "@open-trainer/ftms/raw";
import { createMockTrainer } from "@open-trainer/ftms/testing";
import { createTrainer, type FtmsTransport } from "@open-trainer/ftms/transport";
import { createWebBluetoothTrainer } from "@open-trainer/ftms/web-bluetooth";

const mock: Trainer = createMockTrainer();
const connectionLabel = mapState(mock.connection, (state) => state.toUpperCase());
const encodedPower = targetPowerCommand(200);

declare const customTransport: FtmsTransport;
const custom: Trainer = createTrainer(customTransport);
const browser: Trainer = createWebBluetoothTrainer();

void connectionLabel;
void encodedPower;
void custom;
void browser;
