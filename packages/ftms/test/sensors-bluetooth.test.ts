import { describe, expect, it, vi } from "vitest";
import { SENSOR_UUIDS, WebBluetoothSensorTransport } from "../src/sensors.js";

function mockBluetooth(): {
  browser: Pick<Bluetooth, "requestDevice">;
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  characteristic: BluetoothRemoteGATTCharacteristic;
  notify: (value?: DataView) => void;
  lose: () => void;
  connected: () => boolean;
  listeners: Set<string>;
  battery: { readValue: ReturnType<typeof vi.fn> };
  service: {
    getCharacteristic: ReturnType<typeof vi.fn<() => Promise<BluetoothRemoteGATTCharacteristic>>>;
  };
} {
  const listeners = new Set<string>();
  let onValue: (() => void) | undefined;
  let onDisconnect: (() => void) | undefined;
  let connected = false;
  const characteristic = {
    value: undefined as DataView | undefined,
    addEventListener: vi.fn((name: string, handler: () => void) => {
      onValue = handler;
      listeners.add(name);
    }),
    removeEventListener: vi.fn((name: string) => {
      onValue = undefined;
      listeners.delete(name);
    }),
    startNotifications: vi.fn(async () => characteristic),
  };
  const battery = { readValue: vi.fn(async () => new DataView(Uint8Array.of(83).buffer)) };
  const service = {
    getCharacteristic: vi.fn(
      async () => characteristic as unknown as BluetoothRemoteGATTCharacteristic,
    ),
  };
  const server = {
    get connected(): boolean {
      return connected;
    },
    connect: vi.fn(async () => {
      connected = true;
      return server;
    }),
    disconnect: vi.fn(() => {
      connected = false;
      onDisconnect?.();
    }),
    getPrimaryService: vi.fn(async (uuid: number) => {
      if (uuid === SENSOR_UUIDS.battery.service)
        return { getCharacteristic: vi.fn(async () => battery) };
      return service;
    }),
  };
  const device = {
    name: "Sensor",
    gatt: server,
    addEventListener: vi.fn((name: string, handler: () => void) => {
      onDisconnect = handler;
      listeners.add(name);
    }),
    removeEventListener: vi.fn((name: string) => {
      onDisconnect = undefined;
      listeners.delete(name);
    }),
  };
  const browser = { requestDevice: vi.fn(async () => device as unknown as BluetoothDevice) };
  return {
    browser,
    device: device as unknown as BluetoothDevice,
    server: server as unknown as BluetoothRemoteGATTServer,
    characteristic: characteristic as unknown as BluetoothRemoteGATTCharacteristic,
    notify(value) {
      characteristic.value = value;
      onValue?.();
    },
    lose() {
      connected = false;
      onDisconnect?.();
    },
    connected: () => connected,
    listeners,
    battery,
    service,
  };
}

describe("Web Bluetooth fitness sensor transport", () => {
  it.each(["heart-rate", "cadence", "power"] as const)(
    "requests exactly the %s service from a direct connect gesture",
    async (kind) => {
      const fake = mockBluetooth();
      const transport = new WebBluetoothSensorTransport({ bluetooth: fake.browser });
      const received = vi.fn();
      const lost = vi.fn();
      const pending = transport.connect(kind, received, lost);
      expect(fake.browser.requestDevice).toHaveBeenCalledWith({
        filters: [{ services: [SENSOR_UUIDS[kind].service] }],
        optionalServices: [0x180f],
      });
      await expect(pending).resolves.toEqual({ name: "Sensor", batteryPercent: 83 });
      const packet = new DataView(Uint8Array.of(0, 145).buffer);
      fake.notify(packet);
      expect(received).toHaveBeenCalledTimes(1);
      expect(received.mock.calls[0]?.[0]).not.toBe(packet);
      fake.notify();
      expect(received).toHaveBeenCalledTimes(1);
      await expect(transport.connect(kind, received, lost)).rejects.toThrow("already active");
      await transport.disconnect();
      await transport.disconnect();
      expect(fake.connected()).toBe(false);
      expect(fake.listeners.size).toBe(0);
      expect(lost).not.toHaveBeenCalled();
    },
  );
  it("supports injected devices and optional battery failure", async () => {
    const fake = mockBluetooth();
    fake.battery.readValue.mockRejectedValue(new Error("not supported"));
    const transport = new WebBluetoothSensorTransport({ device: fake.device });
    await expect(transport.connect("power", vi.fn(), vi.fn())).resolves.toEqual({
      name: "Sensor",
      batteryPercent: null,
    });
    await transport.disconnect();
  });
  it.each([[], [255], [100, 1]])("ignores invalid optional battery %j", async (...values) => {
    const fake = mockBluetooth();
    fake.battery.readValue.mockResolvedValue(new DataView(Uint8Array.from(values).buffer));
    const transport = new WebBluetoothSensorTransport({ device: fake.device });
    expect((await transport.connect("power", vi.fn(), vi.fn())).batteryPercent).toBeNull();
    await transport.disconnect();
  });
  it("cleans all listeners when the link drops and can reconnect", async () => {
    const fake = mockBluetooth();
    const lost = vi.fn();
    const transport = new WebBluetoothSensorTransport({ device: fake.device });
    await transport.connect("cadence", vi.fn(), lost);
    fake.lose();
    fake.lose();
    expect(lost).toHaveBeenCalledTimes(1);
    expect(fake.listeners.size).toBe(0);
    await transport.connect("cadence", vi.fn(), lost);
    await transport.disconnect();
  });
  it("reports missing browser and missing GATT", async () => {
    const transport = new WebBluetoothSensorTransport();
    await expect(transport.connect("heart-rate", vi.fn(), vi.fn())).rejects.toThrow("unavailable");
    const noGatt = new WebBluetoothSensorTransport({
      device: new EventTarget() as BluetoothDevice,
    });
    await expect(noGatt.connect("heart-rate", vi.fn(), vi.fn())).rejects.toThrow(
      "no Bluetooth GATT",
    );
  });
  it("accepts a nameless sensor", async () => {
    const fake = mockBluetooth();
    Reflect.deleteProperty(fake.device, "name");
    const transport = new WebBluetoothSensorTransport({ device: fake.device });
    expect((await transport.connect("heart-rate", vi.fn(), vi.fn())).name).toBeNull();
    await transport.disconnect();
  });
  it("rolls back failed notification setup", async () => {
    const fake = mockBluetooth();
    vi.spyOn(fake.characteristic, "startNotifications").mockRejectedValue(
      new Error("Notifications failed"),
    );
    const transport = new WebBluetoothSensorTransport({ device: fake.device });
    await expect(transport.connect("power", vi.fn(), vi.fn())).rejects.toThrow(
      "Notifications failed",
    );
    expect(fake.listeners.size).toBe(0);
    expect(fake.connected()).toBe(false);
  });
  it("cancels a pending chooser without ever connecting the late device", async () => {
    const fake = mockBluetooth();
    let choose: ((device: BluetoothDevice) => void) | undefined;
    vi.mocked(fake.browser.requestDevice).mockImplementation(
      () =>
        new Promise((resolve) => {
          choose = resolve;
        }),
    );
    const transport = new WebBluetoothSensorTransport({ bluetooth: fake.browser });
    const pending = transport.connect("power", vi.fn(), vi.fn());
    const rejected = expect(pending).rejects.toThrow("ended");
    await transport.disconnect();
    choose?.(fake.device);
    await rejected;
    expect(vi.spyOn(fake.server, "connect")).not.toHaveBeenCalled();
    expect(fake.listeners.size).toBe(0);
  });
  it("cancels GATT connect and disconnects its late completion", async () => {
    const fake = mockBluetooth();
    let complete: ((server: BluetoothRemoteGATTServer) => void) | undefined;
    vi.spyOn(fake.server, "connect").mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const transport = new WebBluetoothSensorTransport({ device: fake.device });
    const pending = transport.connect("power", vi.fn(), vi.fn());
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await transport.disconnect();
    vi.spyOn(fake.server, "disconnect").mockClear();
    complete?.(fake.server);
    await rejected;
    expect(vi.spyOn(fake.server, "disconnect")).toHaveBeenCalledOnce();
    expect(fake.listeners.size).toBe(0);
  });
  it.each([false, true])(
    "preserves a replacement after stale discovery completes (new transport: %s)",
    async (newTransport) => {
      const fake = mockBluetooth();
      let complete: ((value: BluetoothRemoteGATTCharacteristic) => void) | undefined;
      fake.service.getCharacteristic.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      const transport = new WebBluetoothSensorTransport({ device: fake.device });
      const pending = transport.connect("power", vi.fn(), vi.fn());
      const rejected = expect(pending).rejects.toThrow("ended");
      await vi.waitFor(() => expect(complete).toBeDefined());
      await transport.disconnect();
      const replacement = newTransport
        ? new WebBluetoothSensorTransport({ device: fake.device })
        : transport;
      const received = vi.fn();
      const lost = vi.fn();
      await replacement.connect("power", received, lost);
      complete?.(fake.characteristic);
      await rejected;
      expect(fake.connected()).toBe(true);
      expect(vi.spyOn(fake.server, "disconnect")).toHaveBeenCalledOnce();
      expect(lost).not.toHaveBeenCalled();
      fake.notify(new DataView(Uint8Array.of(0, 0, 200, 0).buffer));
      expect(received).toHaveBeenCalledOnce();
      await replacement.disconnect();
      expect(fake.listeners.size).toBe(0);
    },
  );
  it.each([false, true])(
    "preserves a replacement after stale GATT connect completes (new transport: %s)",
    async (newTransport) => {
      const fake = mockBluetooth();
      let complete: ((value: BluetoothRemoteGATTServer) => void) | undefined;
      vi.spyOn(fake.server, "connect").mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      const transport = new WebBluetoothSensorTransport({ device: fake.device });
      const pending = transport.connect("power", vi.fn(), vi.fn());
      const rejected = expect(pending).rejects.toThrow("cancelled");
      await transport.disconnect();
      const replacement = newTransport
        ? new WebBluetoothSensorTransport({ device: fake.device })
        : transport;
      const lost = vi.fn();
      await replacement.connect("power", vi.fn(), lost);
      complete?.(fake.server);
      await rejected;
      expect(fake.connected()).toBe(true);
      expect(vi.spyOn(fake.server, "disconnect")).toHaveBeenCalledOnce();
      expect(lost).not.toHaveBeenCalled();
      await replacement.disconnect();
      expect(fake.listeners.size).toBe(0);
    },
  );
  it("tears down if disconnected during characteristic discovery", async () => {
    const fake = mockBluetooth();
    fake.service.getCharacteristic.mockImplementationOnce(() => {
      fake.lose();
      return Promise.resolve(fake.characteristic);
    });
    const transport = new WebBluetoothSensorTransport({ device: fake.device });
    await expect(transport.connect("power", vi.fn(), vi.fn())).rejects.toThrow("ended");
    expect(fake.listeners.size).toBe(0);
  });
  it("ignores platform disconnect errors after removing local listeners", async () => {
    const fake = mockBluetooth();
    const transport = new WebBluetoothSensorTransport({ device: fake.device });
    await transport.connect("power", vi.fn(), vi.fn());
    vi.spyOn(fake.server, "disconnect").mockImplementationOnce(() => {
      throw new Error("already gone");
    });
    await transport.disconnect();
    expect(fake.listeners.size).toBe(0);
  });
});
