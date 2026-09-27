import { afterEach, describe, expect, it, vi } from "vitest";
import { FTMS_ERROR_CODE } from "../src/errors.js";
import { FTMS_UUIDS } from "../src/uuids.js";
import { WebBluetoothFtmsTransport } from "../src/web-bluetooth-transport.js";
import { createWebBluetoothTrainer } from "../src/web-bluetooth.js";

class FakeCharacteristic extends EventTarget {
  value: DataView | undefined;
  readonly writes: number[][] = [];
  starts = 0;
  stops = 0;
  readFailure: Error | undefined;
  writeFailure: Error | undefined;
  notificationFailure: Error | undefined;

  async readValue(): Promise<DataView> {
    if (this.readFailure) throw this.readFailure;
    return this.value ?? new DataView(Uint8Array.of(1, 2, 3).buffer);
  }

  async writeValueWithResponse(value: BufferSource): Promise<void> {
    if (this.writeFailure) throw this.writeFailure;
    const bytes =
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    this.writes.push([...bytes]);
  }

  async startNotifications(): Promise<this> {
    if (this.notificationFailure) throw this.notificationFailure;
    this.starts += 1;
    return this;
  }

  async stopNotifications(): Promise<this> {
    this.stops += 1;
    return this;
  }

  notify(bytes: Uint8Array): void {
    this.value = new DataView(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    this.dispatchEvent(new Event("characteristicvaluechanged"));
  }
}

class FakeGattServer {
  connected = false;
  connectCount = 0;
  disconnectCount = 0;
  serviceFailure: Error | undefined;
  characteristicLookups = 0;
  disconnectFailure: Error | undefined;

  constructor(private readonly characteristic: FakeCharacteristic) {}

  async connect(): Promise<BluetoothRemoteGATTServer> {
    this.connected = true;
    this.connectCount += 1;
    return this as unknown as BluetoothRemoteGATTServer;
  }

  disconnect(): void {
    if (this.disconnectFailure) throw this.disconnectFailure;
    this.connected = false;
    this.disconnectCount += 1;
  }

  async getPrimaryService(): Promise<BluetoothRemoteGATTService> {
    if (this.serviceFailure) throw this.serviceFailure;
    return {
      getCharacteristic: async () => {
        this.characteristicLookups += 1;
        return this.characteristic as unknown as BluetoothRemoteGATTCharacteristic;
      },
    } as unknown as BluetoothRemoteGATTService;
  }
}

class FakeDevice extends EventTarget {
  readonly name = "Test Trainer";
  readonly gatt: FakeGattServer;
  disconnectListeners = 0;

  constructor(characteristic: FakeCharacteristic) {
    super();
    this.gatt = new FakeGattServer(characteristic);
  }

  override addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "gattserverdisconnected") this.disconnectListeners += 1;
    super.addEventListener(type, listener);
  }

  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "gattserverdisconnected") this.disconnectListeners -= 1;
    super.removeEventListener(type, listener);
  }
}

function createFixture(): {
  characteristic: FakeCharacteristic;
  device: FakeDevice;
  transport: WebBluetoothFtmsTransport;
} {
  const characteristic = new FakeCharacteristic();
  const device = new FakeDevice(characteristic);
  const transport = new WebBluetoothFtmsTransport({
    device: device as unknown as BluetoothDevice,
  });
  return { characteristic, device, transport };
}

describe("WebBluetoothFtmsTransport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reconnects after a disconnect requested during connection setup", async () => {
    const { device, transport } = createFixture();
    const service = await device.gatt.getPrimaryService();
    let finish: ((value: BluetoothRemoteGATTService) => void) | undefined;
    vi.spyOn(device.gatt, "getPrimaryService").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const initial = transport.connect();
    await vi.waitFor(() => expect(finish).toBeDefined());
    const disconnect = transport.disconnect();
    const reconnect = transport.connect();
    finish?.(service);
    await Promise.all([initial, disconnect, reconnect]);
    expect(device.gatt.connectCount).toBe(2);
    expect(transport.isConnected).toBe(true);
    await transport.disconnect();
  });

  it("rejects service discovery completed after connection loss", async () => {
    const { device, transport } = createFixture();
    const service = await device.gatt.getPrimaryService();
    let finish: ((value: BluetoothRemoteGATTService) => void) | undefined;
    vi.spyOn(device.gatt, "getPrimaryService").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const connecting = expect(transport.connect()).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.operationClosed,
    });
    await vi.waitFor(() => expect(finish).toBeDefined());
    device.gatt.connected = false;
    device.dispatchEvent(new Event("gattserverdisconnected"));
    finish?.(service);
    await connecting;
    expect(transport.isConnected).toBe(false);
    await transport.connect();
    expect(transport.isConnected).toBe(true);
    await transport.disconnect();
  });

  it("rejects a read completed after reconnect instead of returning stale data", async () => {
    const { characteristic, transport } = createFixture();
    let finish: ((value: DataView) => void) | undefined;
    vi.spyOn(characteristic, "readValue").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await transport.connect();
    const read = expect(transport.read(FTMS_UUIDS.feature)).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.operationClosed,
    });
    await vi.waitFor(() => expect(finish).toBeDefined());
    await transport.disconnect();
    await transport.connect();
    finish?.(new DataView(Uint8Array.of(99).buffer));
    await read;
    expect((await transport.read(FTMS_UUIDS.feature)).getUint8(0)).toBe(1);
    await transport.disconnect();
  });

  it("does not cache a characteristic discovered for an earlier connection", async () => {
    const { device, transport } = createFixture();
    const oldCharacteristic = new FakeCharacteristic();
    const oldRead = vi.spyOn(oldCharacteristic, "readValue");
    let finish: ((value: BluetoothRemoteGATTCharacteristic) => void) | undefined;
    vi.spyOn(device.gatt, "getPrimaryService").mockResolvedValueOnce({
      getCharacteristic: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    } as unknown as BluetoothRemoteGATTService);
    await transport.connect();
    const read = expect(transport.read(FTMS_UUIDS.feature)).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.operationClosed,
    });
    await vi.waitFor(() => expect(finish).toBeDefined());
    await transport.disconnect();
    await transport.connect();
    finish?.(oldCharacteristic as unknown as BluetoothRemoteGATTCharacteristic);
    await read;
    expect(oldRead).not.toHaveBeenCalled();
    await transport.read(FTMS_UUIDS.feature);
    expect(device.gatt.characteristicLookups).toBe(1);
    await transport.disconnect();
  });

  it("releases a notification listener whose setup completes after disconnect", async () => {
    const { characteristic, transport } = createFixture();
    let finish: ((value: FakeCharacteristic) => void) | undefined;
    vi.spyOn(characteristic, "startNotifications").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const remove = vi.spyOn(characteristic, "removeEventListener");
    const listener = vi.fn();
    await transport.connect();
    const subscribing = expect(
      transport.subscribe(FTMS_UUIDS.indoorBikeData, listener),
    ).rejects.toMatchObject({ code: FTMS_ERROR_CODE.operationClosed });
    await vi.waitFor(() => expect(finish).toBeDefined());
    await transport.disconnect();
    finish?.(characteristic);
    await subscribing;
    characteristic.notify(Uint8Array.of(1));
    expect(listener).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("detaches active notification listeners on link loss", async () => {
    const { characteristic, device, transport } = createFixture();
    const remove = vi.spyOn(characteristic, "removeEventListener");
    const listener = vi.fn();
    await transport.connect();
    const unsubscribe = await transport.subscribe(FTMS_UUIDS.indoorBikeData, listener);
    device.gatt.connected = false;
    device.dispatchEvent(new Event("gattserverdisconnected"));
    characteristic.notify(Uint8Array.of(1));
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledOnce();
    expect(characteristic.stops).toBe(0);
  });

  it("connects an injected device without invoking the browser picker", async () => {
    const { device, transport } = createFixture();

    await transport.connect();

    expect(transport.deviceName).toBe("Test Trainer");
    expect(transport.isConnected).toBe(true);
    expect(device.gatt.connectCount).toBe(1);
    expect(device.disconnectListeners).toBe(1);
    await transport.disconnect();
    expect(device.disconnectListeners).toBe(0);
  });

  it("copies writes before queueing so caller mutation cannot alter the command", async () => {
    const { characteristic, transport } = createFixture();
    await transport.connect();
    const command = Uint8Array.of(0x05, 0xc8, 0x00);

    const write = transport.write(FTMS_UUIDS.controlPoint, command);
    command.fill(0xff);
    await write;

    expect(characteristic.writes).toEqual([[0x05, 0xc8, 0x00]]);
    await transport.disconnect();
  });

  it("copies notification data and stops notifications on unsubscribe", async () => {
    const { characteristic, transport } = createFixture();
    await transport.connect();
    const notifications: number[][] = [];
    const unsubscribe = await transport.subscribe(FTMS_UUIDS.indoorBikeData, (view) => {
      notifications.push([...new Uint8Array(view.buffer, view.byteOffset, view.byteLength)]);
    });

    characteristic.notify(Uint8Array.of(1, 2, 3));
    characteristic.value?.setUint8(0, 9);
    unsubscribe();
    await Promise.resolve();
    await Promise.resolve();

    expect(notifications).toEqual([[1, 2, 3]]);
    expect(characteristic.starts).toBe(1);
    expect(characteristic.stops).toBe(1);
    await transport.disconnect();
  });

  it("fully rolls back a failed service discovery", async () => {
    const { device, transport } = createFixture();
    device.gatt.serviceFailure = new Error("missing FTMS service");
    let disconnectEvents = 0;
    transport.onDisconnect(() => {
      disconnectEvents += 1;
    });

    await expect(transport.connect()).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.transportFailure,
    });

    expect(transport.isConnected).toBe(false);
    expect(device.gatt.disconnectCount).toBe(1);
    expect(device.disconnectListeners).toBe(0);
    device.dispatchEvent(new Event("gattserverdisconnected"));
    expect(disconnectEvents).toBe(0);
  });

  it("uses the browser picker with an FTMS filter and supports a name-prefix filter", async () => {
    const characteristic = new FakeCharacteristic();
    const device = new FakeDevice(characteristic);
    const requestDevice = vi.fn(async () => device as unknown as BluetoothDevice);
    vi.stubGlobal("navigator", { bluetooth: { requestDevice } });
    const transport = new WebBluetoothFtmsTransport({ namePrefix: "KICKR" });

    await transport.connect();

    expect(requestDevice).toHaveBeenCalledWith({
      filters: [{ namePrefix: "KICKR" }],
      optionalServices: [FTMS_UUIDS.service],
    });
    await transport.disconnect();
  });

  it("rejects predictably when Web Bluetooth is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const transport = new WebBluetoothFtmsTransport();

    await expect(transport.connect()).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.bluetoothUnavailable,
    });
  });

  it("caches characteristics and returns independent read buffers", async () => {
    const { characteristic, device, transport } = createFixture();
    characteristic.value = new DataView(Uint8Array.of(4, 5, 6).buffer);
    await transport.connect();

    const first = await transport.read(FTMS_UUIDS.feature);
    characteristic.value.setUint8(0, 9);
    const second = await transport.read(FTMS_UUIDS.feature);

    expect(first.getUint8(0)).toBe(4);
    expect(second.getUint8(0)).toBe(9);
    expect(device.gatt.characteristicLookups).toBe(1);
    await transport.disconnect();
  });

  it("normalizes GATT read, write, and notification setup failures", async () => {
    const { characteristic, transport } = createFixture();
    await transport.connect();

    characteristic.readFailure = new Error("read failed");
    await expect(transport.read(FTMS_UUIDS.feature)).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.transportFailure,
    });
    characteristic.readFailure = undefined;
    characteristic.writeFailure = new Error("write failed");
    await expect(
      transport.write(FTMS_UUIDS.controlPoint, Uint8Array.of(0x00)),
    ).rejects.toMatchObject({ code: FTMS_ERROR_CODE.transportFailure });
    characteristic.writeFailure = undefined;
    characteristic.notificationFailure = new Error("notifications failed");
    await expect(
      transport.subscribe(FTMS_UUIDS.indoorBikeData, () => undefined),
    ).rejects.toMatchObject({ code: FTMS_ERROR_CODE.transportFailure });
    await transport.disconnect();
  });

  it("emits one disconnect signal and closes operations after link loss", async () => {
    const { device, transport } = createFixture();
    let disconnectEvents = 0;
    transport.onDisconnect(() => {
      disconnectEvents += 1;
    });
    await transport.connect();

    device.gatt.connected = false;
    device.dispatchEvent(new Event("gattserverdisconnected"));
    device.dispatchEvent(new Event("gattserverdisconnected"));

    expect(disconnectEvents).toBe(1);
    expect(transport.isConnected).toBe(false);
    await expect(transport.read(FTMS_UUIDS.feature)).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.operationClosed,
    });
  });

  it("constructs the public Web Bluetooth trainer factory", () => {
    const { device } = createFixture();
    const trainer = createWebBluetoothTrainer({
      device: device as unknown as BluetoothDevice,
    });

    expect(trainer.deviceName).toBe("Test Trainer");
    expect(trainer.connection.current).toBe("disconnected");
  });

  it("shares direct concurrent connects and returns early when already connected", async () => {
    const { device, transport } = createFixture();

    await Promise.all([transport.connect(), transport.connect()]);
    await transport.connect();

    expect(device.gatt.connectCount).toBe(1);
    await transport.disconnect();
  });

  it("normalizes picker failures and uses the service filter by default", async () => {
    const requestDevice = vi.fn(() => Promise.reject(new Error("picker cancelled")));
    vi.stubGlobal("navigator", { bluetooth: { requestDevice } });
    const transport = new WebBluetoothFtmsTransport();

    await expect(transport.connect()).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.transportFailure,
    });
    expect(requestDevice).toHaveBeenCalledWith({
      filters: [{ services: [FTMS_UUIDS.service] }],
      optionalServices: [FTMS_UUIDS.service],
    });
  });

  it("rejects a selected device without GATT", async () => {
    const device = Object.assign(new EventTarget(), {
      name: "No GATT",
      gatt: undefined,
    });
    const transport = new WebBluetoothFtmsTransport({
      device: device as unknown as BluetoothDevice,
    });

    await expect(transport.connect()).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.invalidState,
    });
  });

  it("cleans state and emits disconnect even if the platform disconnect throws", async () => {
    const { device, transport } = createFixture();
    let disconnectEvents = 0;
    transport.onDisconnect(() => {
      disconnectEvents += 1;
    });
    await transport.connect();
    device.gatt.disconnectFailure = new Error("platform disconnect failed");

    await expect(transport.disconnect()).rejects.toMatchObject({
      code: FTMS_ERROR_CODE.transportFailure,
    });

    expect(transport.isConnected).toBe(false);
    expect(disconnectEvents).toBe(1);
  });
});
