# @open-trainer/ftms

[![CI](https://github.com/cemergin/open-trainer-ftms/actions/workflows/ci.yml/badge.svg)](https://github.com/cemergin/open-trainer-ftms/actions/workflows/ci.yml)

A transport-independent, strongly typed library for reading and controlling Bluetooth FTMS smart trainers. The initial hardware target is Wahoo KICKR CORE firmware 1.1.1 or newer.

This package is ESM-only and currently pre-1.0. Its production software gates are automated; npm's `latest` channel remains blocked until physical-trainer evidence is committed and verified.

## Install

```sh
npm install @open-trainer/ftms
```

The Web Bluetooth adapter requires a browser with `navigator.bluetooth` and a secure context: HTTPS in production or `localhost` during development. Device selection must begin inside a user gesture. Applications can use the simulator and protocol codecs without Web Bluetooth hardware.

## Quick start

```ts
import { createWebBluetoothTrainer } from "@open-trainer/ftms/web-bluetooth";

const trainer = createWebBluetoothTrainer();
const unsubscribe = trainer.telemetry.subscribe((sample) => {
  if (sample) console.log(sample.instantaneousPowerWatts);
});

const capabilities = await trainer.connect();
if (capabilities.supportsPowerTarget) {
  await trainer.acquireControl();
  try {
    await trainer.setTargetPower(140);
    await trainer.start();
  } finally {
    await trainer.stop();
  }
}

// On shutdown:
await trainer.disconnect();
unsubscribe();
```

`connect()` must be called from a user gesture when the Web Bluetooth device chooser is required.

## Entry points

| Import                             | Stability and purpose                                                 |
| ---------------------------------- | --------------------------------------------------------------------- |
| `@open-trainer/ftms`               | Stable trainer contracts, errors, reactive primitives, and transforms |
| `@open-trainer/ftms/web-bluetooth` | Browser adapter and trainer factory                                   |
| `@open-trainer/ftms/testing`       | Simulator and deterministic test utilities                            |
| `@open-trainer/ftms/sensors`       | Standard heart-rate, crank-cadence, and cycling-power sensors         |
| `@open-trainer/ftms/transport`     | Extension point for custom BLE or native transports                   |
| `@open-trainer/ftms/raw`           | Low-level FTMS UUIDs and packet codecs; intentionally less stable     |

Applications should depend on the semantic root API and adapter factories. Keep raw packet parsing outside application and game code.

## Reactive state

Current state is synchronously available while subscriptions receive the initial value and future changes:

```ts
console.log(trainer.connection.current);

const unsubscribe = trainer.connection.subscribe((state) => {
  console.log(state);
});

unsubscribe();
```

State values represent connection, control ownership, activity, capabilities, and the latest telemetry. Streams represent transient control responses, machine-status packets, and errors. Telemetry becomes `null` on disconnect so applications cannot accidentally display stale watts as live data.

`machineStatusEvents` exposes parsed lifecycle events while `machineStatus` retains raw bytes for diagnostics and future protocol additions. Subscriber exceptions are isolated and routed to `errors`, so one UI component cannot interrupt trainer state processing.

`commandEvents` reports command IDs, opcodes, queue/send/acknowledgment phases, elapsed time, transport latency, and rejection or timeout details. IDs increase across reconnects for the lifetime of a trainer instance. Known Machine Status events expose typed `decodedParameters`; raw bytes and unknown opcodes remain available.

## Separate Bluetooth sensors

The sensors entry point supports standard Heart Rate, Cycling Speed and Cadence crank measurements, and Cycling Power services. Sensor state and measurements use the same read-only subscription style as trainers. `telemetry.value` is bpm, rpm, or watts according to the sensor kind; it becomes `null` when stale or disconnected. The default freshness timeout is five seconds. Battery level is optional, and cadence needs successive crank notifications before producing a value.

This example runs without Bluetooth hardware:

```ts
import { createMockSensor } from "@open-trainer/ftms/sensors";

const sensor = createMockSensor("heart-rate");
const unsubscribe = sensor.telemetry.subscribe(({ value, fresh }) => {
  console.log({ bpm: value, fresh });
});
await sensor.connect();
console.log(sensor.state.current.name, sensor.telemetry.current.batteryPercent);
await sensor.disconnect();
unsubscribe();
```

For hardware, use `createWebBluetoothSensor("heart-rate")`, `createWebBluetoothSensor("cadence")`, or `createWebBluetoothSensor("power")` and call `connect()` directly from the pairing button's user gesture. Pair each selected sensor explicitly. Source selection and combining sensor data with trainer telemetry belong to the application. `FitnessSensor`, `SensorTransport`, and the exported parsers support custom transports and protocol tests.

## Commands and safety

Commands are asynchronous and serialized. A normal controlled session is:

1. `connect()` and inspect the returned capabilities.
2. `acquireControl()`.
3. Select a supported target with `setTargetPower()`, `setResistanceLevel()`, or `setSimulation()`.
4. `start()`.
5. `stop()` before `disconnect()`.

Do not send ERG or resistance targets that the connected trainer did not advertise. Test new hardware behavior at low resistance on an unoccupied bike. An application must always expose an obvious stop control and handle disconnect/error events.

All command methods reject with typed `FtmsError` subclasses. Branch on the stable `error.code` values in `FTMS_ERROR_CODE`; human-readable messages are diagnostic text rather than API contracts.

When advertised, `setTargetCadence(rpm)` sends cadence guidance and `spinDown("start" | "ignore")` controls the standard FTMS spin-down procedure. Both require control ownership. The spin-down response provides the accepted speed window; completion arrives later in `machineStatusEvents` as a `spin-down-status` event. An accepted command does not mean calibration succeeded. Physical calibration behavior still requires device qualification.

FTMS 1.0 uses a two-byte `UINT8` target-resistance procedure, while FTMS 1.0.1 uses a three-byte `SINT16` procedure. The package defaults to 1.0.1. Configure a confirmed legacy device explicitly:

```ts
const trainer = createWebBluetoothTrainer(
  {},
  {
    resistanceControlFormat: "uint8",
  },
);
```

Resistance-range discovery accepts exact three-byte UINT8 fields in whole levels or a six-byte layout with signed minimum/maximum and an unsigned increment, all in tenths. Discovery is independent of the selected command format, which still requires explicit configuration for a confirmed legacy device.

Discovery is strict by default: if a trainer advertises a target feature but its required range or Machine Status cannot be configured, `connect()` rejects. `strictProtocol: false` is available only as an explicit interoperability escape hatch and emits the discovery failures on `errors`.

## Record, replay, and inject faults

The testing entry point wraps the public `FtmsTransport` interface. Recording captures protocol bytes, relative times, and connection sessions; it excludes device names, addresses, and wall-clock timestamps. Recording limits mark a trace as truncated instead of growing without bound. `parseTransportTrace()` validates imported data and strips unrelated properties. Replay rejects truncated traces and mismatched writes, and never connects to hardware.

This complete example records a simulated session, then repeats its command sequence offline:

```ts
import { createTrainer, type FtmsTransport } from "@open-trainer/ftms/transport";
import {
  MockFtmsTransport,
  RecordingFtmsTransport,
  ReplayFtmsTransport,
  parseTransportTrace,
} from "@open-trainer/ftms/testing";

async function runSession(transport: FtmsTransport): Promise<void> {
  const trainer = createTrainer(transport);
  await trainer.connect();
  await trainer.acquireControl();
  await trainer.setTargetPower(100);
  await trainer.start();
  await trainer.stop();
  await trainer.disconnect();
}

const recording = new RecordingFtmsTransport(new MockFtmsTransport());
await runSession(recording);
const json = JSON.stringify(recording.trace);
const trace = parseTransportTrace(JSON.parse(json));
await runSession(new ReplayFtmsTransport(trace));
```

`FaultInjectionFtmsTransport` applies explicit, one-shot rules for a matching read, write, or notification. Rules can match a characteristic, opcode, and occurrence, then delay, replace, reject, disconnect, or drop notifications. For example, test a failed first write without hardware:

```ts
import { createTrainer } from "@open-trainer/ftms/transport";
import { FaultInjectionFtmsTransport, MockFtmsTransport } from "@open-trainer/ftms/testing";

const trainer = createTrainer(
  new FaultInjectionFtmsTransport(new MockFtmsTransport(), [
    { operation: "write", action: "reject", occurrence: 1 },
  ]),
);
await trainer.connect();
try {
  await trainer.acquireControl();
} catch (error) {
  console.log("Expected injected failure:", error);
} finally {
  await trainer.disconnect();
}
```

These tools exercise software behavior; simulator and replay results do not qualify physical hardware.

## Implemented

- Fitness Machine Feature and supported-range discovery
- Indoor Bike Data parsing
- Request control, reset, start, pause and stop
- ERG target power
- Manual resistance level
- Indoor-bike simulation parameters
- Capability-gated target cadence and spin-down procedures
- Heart-rate, crank-cadence, and cycling-power sensor pairing, battery discovery, and freshness
- Serialized control-point procedures with timeouts
- Late-response quarantine after a command timeout
- Setpoint coalescing and stop/pause/reset priority over queued targets
- Serialized browser GATT operations
- Stable error codes and typed Machine Status lifecycle events
- Decoded Machine Status parameters and command timing events
- FTMS 1.0 and 1.0.1 resistance-control formats
- Dependency-free reactive state and stream transforms
- Real Web Bluetooth and simulated transports
- Bounded transport recording, offline replay, and explicit fault injection

## Deliberately deferred

- Firmware updates and factory procedures
- Physical qualification of spin-down calibration
- Vendor-specific Wahoo and Zwift services
- ANT+

The library is capability-driven. Applications should check the object returned by `connect()` instead of assuming every trainer implements every FTMS feature.

## Development and support

The repository enforces type-aware lint, deterministic formatting, 95% statement/line/function and 80% branch coverage, strict TypeScript, NodeNext and bundler consumer compilation, `publint`, Are the Types Wrong, and an installed-tarball runtime smoke test before publishing.

- [Repository and Trainer Lab](https://github.com/cemergin/open-trainer-ftms)
- [Issue tracker](https://github.com/cemergin/open-trainer-ftms/issues)
- [Security policy](https://github.com/cemergin/open-trainer-ftms/security/policy)
- [Contributing guide](https://github.com/cemergin/open-trainer-ftms/blob/main/CONTRIBUTING.md)
- [Physical trainer integration guide](https://github.com/cemergin/open-trainer-ftms/blob/main/DEVICE_INTEGRATION_GUIDE.md)
