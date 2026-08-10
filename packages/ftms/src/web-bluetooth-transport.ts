import { FtmsError } from "./errors.js";
import { AsyncOperationQueue } from "./gatt-operation-queue.js";
import { EventSource } from "./reactive.js";
import type { FtmsTransport, Unsubscribe } from "./types.js";
import { FTMS_UUIDS } from "./uuids.js";

export interface WebBluetoothTransportOptions {
  device?: BluetoothDevice;
  namePrefix?: string;
}

function cloneDataView(value: DataView): DataView {
  return new DataView(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
}

export class WebBluetoothFtmsTransport implements FtmsTransport {
  readonly #disconnectSignal = new EventSource<void>();
  readonly #characteristics = new Map<number, BluetoothRemoteGATTCharacteristic>();
  readonly #operations = new AsyncOperationQueue();

  #device: BluetoothDevice | undefined;
  #service: BluetoothRemoteGATTService | undefined;

  constructor(private readonly options: WebBluetoothTransportOptions = {}) {
    this.#device = options.device;
  }

  get isConnected(): boolean {
    return Boolean(this.#device?.gatt?.connected && this.#service);
  }

  get deviceName(): string | undefined {
    return this.#device?.name;
  }

  async connect(): Promise<void> {
    if (!globalThis.navigator?.bluetooth) {
      throw new FtmsError("Web Bluetooth is unavailable. Use Chrome or Edge on a supported device.");
    }

    this.#operations.reopen();

    if (!this.#device) {
      const filters: BluetoothLEScanFilter[] = this.options.namePrefix
        ? [{ namePrefix: this.options.namePrefix }]
        : [{ services: [FTMS_UUIDS.service] }];

      this.#device = await globalThis.navigator.bluetooth.requestDevice({
        filters,
        optionalServices: [FTMS_UUIDS.service],
      });
    }

    if (!this.#device.gatt) throw new FtmsError("The selected trainer has no Bluetooth GATT server.");
    this.#device.addEventListener("gattserverdisconnected", this.#handleDisconnect);
    const server = await this.#device.gatt.connect();
    this.#service = await server.getPrimaryService(FTMS_UUIDS.service);
    this.#characteristics.clear();
  }

  async disconnect(): Promise<void> {
    const wasConnected = this.isConnected;
    this.#device?.removeEventListener("gattserverdisconnected", this.#handleDisconnect);
    this.#device?.gatt?.disconnect();
    this.#service = undefined;
    this.#characteristics.clear();
    this.#operations.close("Bluetooth transport disconnected.");
    if (wasConnected) this.#disconnectSignal.emit();
  }

  async read(characteristic: number): Promise<DataView> {
    return this.#operations.run(async () => {
      const remote = await this.#getCharacteristic(characteristic);
      return cloneDataView(await remote.readValue());
    });
  }

  async write(characteristic: number, value: Uint8Array): Promise<void> {
    await this.#operations.run(async () => {
      const remote = await this.#getCharacteristic(characteristic);
      const payload = new ArrayBuffer(value.byteLength);
      new Uint8Array(payload).set(value);
      await remote.writeValueWithResponse(payload);
    });
  }

  async subscribe(
    characteristic: number,
    listener: (value: DataView) => void,
  ): Promise<Unsubscribe> {
    const { remote, handler } = await this.#operations.run(async () => {
      const remote = await this.#getCharacteristic(characteristic);
      const handler = (): void => {
        if (remote.value) listener(cloneDataView(remote.value));
      };

      remote.addEventListener("characteristicvaluechanged", handler);
      try {
        await remote.startNotifications();
      } catch (error) {
        remote.removeEventListener("characteristicvaluechanged", handler);
        throw error;
      }
      return { remote, handler };
    });

    return () => {
      remote.removeEventListener("characteristicvaluechanged", handler);
      void this.#operations.run(() => remote.stopNotifications()).catch(() => undefined);
    };
  }

  onDisconnect(listener: () => void): Unsubscribe {
    return this.#disconnectSignal.subscribe(listener);
  }

  readonly #handleDisconnect = (): void => {
    this.#service = undefined;
    this.#characteristics.clear();
    this.#operations.close("Bluetooth connection lost.");
    this.#disconnectSignal.emit();
  };

  async #getCharacteristic(uuid: number): Promise<BluetoothRemoteGATTCharacteristic> {
    if (!this.#service) throw new FtmsError("The trainer is not connected.");
    const cached = this.#characteristics.get(uuid);
    if (cached) return cached;
    const characteristic = await this.#service.getCharacteristic(uuid);
    this.#characteristics.set(uuid, characteristic);
    return characteristic;
  }
}
