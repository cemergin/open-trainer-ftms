/// <reference types="web-bluetooth" preserve="true" />
import { SENSOR_UUIDS, type SensorKind, type SensorTransport } from "./sensors-types.js";

export interface WebBluetoothSensorOptions {
  bluetooth?: Pick<Bluetooth, "requestDevice">;
  device?: BluetoothDevice;
}

interface Connection {
  active: boolean;
  device?: BluetoothDevice;
  characteristic?: BluetoothRemoteGATTCharacteristic;
  measurement?: () => void;
  disconnected: () => void;
}

const SERVER_CONNECTIONS = new WeakMap<BluetoothRemoteGATTServer, Set<Connection>>();

/** All discovery is initiated by connect(); no background chooser or auto-reconnection. */
export class WebBluetoothSensorTransport implements SensorTransport {
  #connection: Connection | undefined;

  constructor(private readonly options: WebBluetoothSensorOptions = {}) {}

  async connect(
    kind: SensorKind,
    onMeasurement: (value: DataView) => void,
    onDisconnect: () => void,
  ): Promise<{ name: string | null; batteryPercent: number | null }> {
    if (this.#connection) throw new Error("Sensor connection is already active.");
    const connection: Connection = {
      active: true,
      disconnected: () => {
        if (!connection.active) return;
        this.#release(connection);
        onDisconnect();
      },
    };
    this.#connection = connection;
    const uuids = SENSOR_UUIDS[kind];
    try {
      const runtime = globalThis as unknown as {
        navigator?: { bluetooth?: Pick<Bluetooth, "requestDevice"> };
      };
      const browser = this.options.bluetooth ?? runtime.navigator?.bluetooth;
      const device =
        this.options.device ??
        (await requestDevice(browser, {
          filters: [{ services: [uuids.service] }],
          optionalServices: [SENSOR_UUIDS.battery.service],
        }));
      this.#assertActive(connection);
      connection.device = device;
      if (!device.gatt) throw new Error("The selected sensor has no Bluetooth GATT server.");
      const owners = SERVER_CONNECTIONS.get(device.gatt) ?? new Set<Connection>();
      owners.add(connection);
      SERVER_CONNECTIONS.set(device.gatt, owners);
      device.addEventListener("gattserverdisconnected", connection.disconnected);
      const server = await device.gatt.connect();
      if (!connection.active) {
        this.#disconnectUnclaimedServer(server);
        throw new Error("Sensor connection cancelled.");
      }
      const service = await server.getPrimaryService(uuids.service);
      this.#assertActive(connection);
      const characteristic = await service.getCharacteristic(uuids.measurement);
      this.#assertActive(connection);
      connection.characteristic = characteristic;
      connection.measurement = () => {
        if (!connection.active || !characteristic.value) return;
        const value = characteristic.value;
        onMeasurement(
          new DataView(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)),
        );
      };
      characteristic.addEventListener("characteristicvaluechanged", connection.measurement);
      await characteristic.startNotifications();
      this.#assertActive(connection);
      let batteryPercent: number | null = null;
      try {
        const batteryService = await server.getPrimaryService(SENSOR_UUIDS.battery.service);
        this.#assertActive(connection);
        const battery = await batteryService.getCharacteristic(SENSOR_UUIDS.battery.level);
        this.#assertActive(connection);
        const level = await battery.readValue();
        if (level.byteLength === 1 && level.getUint8(0) <= 100) batteryPercent = level.getUint8(0);
      } catch {
        // Battery Service is optional and must not prevent measurement subscription.
      }
      this.#assertActive(connection);
      return { name: device.name ?? null, batteryPercent };
    } catch (error) {
      this.#release(connection);
      throw error;
    }
  }

  disconnect(): Promise<void> {
    if (this.#connection) this.#release(this.#connection);
    return Promise.resolve();
  }

  #assertActive(connection: Connection): void {
    if (!connection.active) throw new Error("Sensor connection ended during discovery.");
  }

  #release(connection: Connection): void {
    if (!connection.active) return;
    connection.active = false;
    if (connection.measurement)
      connection.characteristic?.removeEventListener(
        "characteristicvaluechanged",
        connection.measurement,
      );
    connection.device?.removeEventListener("gattserverdisconnected", connection.disconnected);
    if (this.#connection === connection) this.#connection = undefined;
    if (connection.device?.gatt) SERVER_CONNECTIONS.get(connection.device.gatt)?.delete(connection);
    this.#disconnectUnclaimedServer(connection.device?.gatt);
  }

  #disconnectUnclaimedServer(server: BluetoothRemoteGATTServer | undefined): void {
    // A cancelled connect may settle after a replacement has acquired the same GATT server.
    if (!server || SERVER_CONNECTIONS.get(server)?.size) return;
    SERVER_CONNECTIONS.delete(server);
    try {
      server.disconnect();
    } catch {
      // Listener removal and local teardown must complete even after a link failure.
    }
  }
}

function requestDevice(
  browser: Pick<Bluetooth, "requestDevice"> | undefined,
  options: RequestDeviceOptions,
): Promise<BluetoothDevice> {
  if (!browser) throw new Error("Web Bluetooth is unavailable.");
  return browser.requestDevice(options);
}
