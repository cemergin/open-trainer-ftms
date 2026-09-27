/// <reference types="web-bluetooth" preserve="true" />

import { FTMS_ERROR_CODE, FtmsError, FtmsStateError, normalizeFtmsError } from "./errors.js";
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
  #connectPromise: Promise<void> | undefined;
  #disconnectPromise: Promise<void> | undefined;
  #generation = 0;
  readonly #subscriptions = new Set<Unsubscribe>();

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
    if (this.#disconnectPromise) await this.#disconnectPromise;
    if (this.isConnected) return;
    if (this.#connectPromise) return this.#connectPromise;
    const operation = this.#connectAfterDisconnect();
    this.#connectPromise = operation;
    try {
      await operation;
    } finally {
      if (this.#connectPromise === operation) this.#connectPromise = undefined;
    }
  }

  async #connectAfterDisconnect(): Promise<void> {
    if (this.#disconnectPromise) await this.#disconnectPromise;
    this.#operations.reopen();
    const generation = this.#generation;

    let device = this.#device;
    try {
      if (!device) {
        const runtime = globalThis as unknown as {
          navigator?: { bluetooth?: Bluetooth };
        };
        const bluetooth = runtime.navigator?.bluetooth;
        if (!bluetooth) {
          throw new FtmsError(
            "Web Bluetooth is unavailable. Use Chrome or Edge on a supported device.",
            { code: FTMS_ERROR_CODE.bluetoothUnavailable },
          );
        }
        const filters: BluetoothLEScanFilter[] = this.options.namePrefix
          ? [{ namePrefix: this.options.namePrefix }]
          : [{ services: [FTMS_UUIDS.service] }];

        device = await bluetooth.requestDevice({
          filters,
          optionalServices: [FTMS_UUIDS.service],
        });
        this.#device = device;
      }

      if (!device.gatt) {
        throw new FtmsStateError("The selected trainer has no Bluetooth GATT server.");
      }
      device.addEventListener("gattserverdisconnected", this.#handleDisconnect);
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(FTMS_UUIDS.service);
      if (generation !== this.#generation || !server.connected) {
        throw new FtmsStateError(
          "Bluetooth disconnected during service discovery.",
          FTMS_ERROR_CODE.operationClosed,
        );
      }
      this.#service = service;
      this.#characteristics.clear();
    } catch (error) {
      device?.removeEventListener("gattserverdisconnected", this.#handleDisconnect);
      this.#service = undefined;
      this.#characteristics.clear();
      this.#generation += 1;
      this.#operations.close("Bluetooth connection setup failed.");
      if (device?.gatt?.connected) device.gatt.disconnect();
      throw normalizeFtmsError(
        error,
        "Connecting to the trainer's FTMS service failed.",
        FTMS_ERROR_CODE.transportFailure,
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.#disconnectPromise) return this.#disconnectPromise;
    const operation = this.#disconnectAfterConnect();
    this.#disconnectPromise = operation;
    try {
      await operation;
    } finally {
      if (this.#disconnectPromise === operation) this.#disconnectPromise = undefined;
    }
  }

  async #disconnectAfterConnect(): Promise<void> {
    if (this.#connectPromise) {
      try {
        await this.#connectPromise;
      } catch {
        // A failed connection attempt already rolls itself back.
      }
    }
    const wasConnected = this.isConnected;
    this.#device?.removeEventListener("gattserverdisconnected", this.#handleDisconnect);
    let failure: unknown;
    let didFail = false;
    try {
      this.#device?.gatt?.disconnect();
    } catch (error) {
      failure = error;
      didFail = true;
    } finally {
      this.#generation += 1;
      for (const unsubscribe of this.#subscriptions) unsubscribe();
      this.#service = undefined;
      this.#characteristics.clear();
      this.#operations.close("Bluetooth transport disconnected.");
      if (wasConnected) this.#disconnectSignal.emit();
    }
    if (didFail) {
      throw normalizeFtmsError(
        failure,
        "Disconnecting from the trainer failed.",
        FTMS_ERROR_CODE.transportFailure,
      );
    }
  }

  async read(characteristic: number): Promise<DataView> {
    try {
      return await this.#operations.run(async () => {
        const remote = await this.#getCharacteristic(characteristic);
        return cloneDataView(await remote.readValue());
      });
    } catch (error) {
      throw normalizeFtmsError(
        error,
        `Reading Bluetooth characteristic 0x${characteristic.toString(16)} failed.`,
        FTMS_ERROR_CODE.transportFailure,
      );
    }
  }

  async write(characteristic: number, value: Uint8Array): Promise<void> {
    const payload = new ArrayBuffer(value.byteLength);
    new Uint8Array(payload).set(value);
    try {
      await this.#operations.run(async () => {
        const remote = await this.#getCharacteristic(characteristic);
        await remote.writeValueWithResponse(payload);
      });
    } catch (error) {
      throw normalizeFtmsError(
        error,
        `Writing Bluetooth characteristic 0x${characteristic.toString(16)} failed.`,
        FTMS_ERROR_CODE.transportFailure,
      );
    }
  }

  async subscribe(
    characteristic: number,
    listener: (value: DataView) => void,
  ): Promise<Unsubscribe> {
    const generation = this.#generation;
    let subscription: { remote: BluetoothRemoteGATTCharacteristic; handler: () => void };
    let detachListener: (() => void) | undefined;
    try {
      subscription = await this.#operations.run(async () => {
        const remote = await this.#getCharacteristic(characteristic);
        const handler = (): void => {
          if (generation === this.#generation && remote.value)
            listener(cloneDataView(remote.value));
        };

        remote.addEventListener("characteristicvaluechanged", handler);
        detachListener = () => {
          remote.removeEventListener("characteristicvaluechanged", handler);
        };
        await remote.startNotifications();
        return { remote, handler };
      });
      if (generation !== this.#generation || !this.isConnected) {
        throw new FtmsStateError(
          "Bluetooth disconnected while subscribing.",
          FTMS_ERROR_CODE.operationClosed,
        );
      }
    } catch (error) {
      detachListener?.();
      throw normalizeFtmsError(
        error,
        `Subscribing to Bluetooth characteristic 0x${characteristic.toString(16)} failed.`,
        FTMS_ERROR_CODE.transportFailure,
      );
    }

    const { remote, handler } = subscription;

    const unsubscribe = (): void => {
      if (!this.#subscriptions.delete(unsubscribe)) return;
      remote.removeEventListener("characteristicvaluechanged", handler);
      if (generation === this.#generation && this.isConnected) {
        void this.#operations.run(() => remote.stopNotifications()).catch(() => undefined);
      }
    };
    this.#subscriptions.add(unsubscribe);
    return unsubscribe;
  }

  onDisconnect(listener: () => void): Unsubscribe {
    return this.#disconnectSignal.subscribe(listener);
  }

  readonly #handleDisconnect = (): void => {
    const hadConnection = Boolean(this.#service);
    this.#generation += 1;
    for (const unsubscribe of this.#subscriptions) unsubscribe();
    this.#device?.removeEventListener("gattserverdisconnected", this.#handleDisconnect);
    this.#service = undefined;
    this.#characteristics.clear();
    this.#operations.close("Bluetooth connection lost.");
    if (hadConnection) this.#disconnectSignal.emit();
  };

  async #getCharacteristic(uuid: number): Promise<BluetoothRemoteGATTCharacteristic> {
    if (!this.#service) {
      throw new FtmsStateError("The trainer is not connected.", FTMS_ERROR_CODE.notConnected);
    }
    const cached = this.#characteristics.get(uuid);
    if (cached) return cached;
    const service = this.#service;
    const generation = this.#generation;
    const characteristic = await service.getCharacteristic(uuid);
    if (generation !== this.#generation || service !== this.#service || !this.isConnected) {
      throw new FtmsStateError(
        "Bluetooth disconnected during characteristic discovery.",
        FTMS_ERROR_CODE.operationClosed,
      );
    }
    this.#characteristics.set(uuid, characteristic);
    return characteristic;
  }
}
