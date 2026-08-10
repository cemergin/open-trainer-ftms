# @open-trainer/ftms

[![CI](https://github.com/cemergin/open-trainer-ftms/actions/workflows/ci.yml/badge.svg)](https://github.com/cemergin/open-trainer-ftms/actions/workflows/ci.yml)

A transport-independent, strongly typed library for reading and controlling Bluetooth FTMS smart trainers. The initial hardware target is Wahoo KICKR CORE firmware 1.1.1 or newer.

This package is ESM-only and currently pre-1.0. Its protocol core and simulator are tested automatically; physical-trainer behavior is still being validated and documented by model and firmware.

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

| Import | Stability and purpose |
| --- | --- |
| `@open-trainer/ftms` | Stable trainer contracts, errors, reactive primitives, and transforms |
| `@open-trainer/ftms/web-bluetooth` | Browser adapter and trainer factory |
| `@open-trainer/ftms/testing` | Simulator and deterministic test utilities |
| `@open-trainer/ftms/transport` | Extension point for custom BLE or native transports |
| `@open-trainer/ftms/raw` | Low-level FTMS UUIDs and packet codecs; intentionally less stable |

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

## Commands and safety

Commands are asynchronous and serialized. A normal controlled session is:

1. `connect()` and inspect the returned capabilities.
2. `acquireControl()`.
3. Select a supported target with `setTargetPower()`, `setResistanceLevel()`, or `setSimulation()`.
4. `start()`.
5. `stop()` before `disconnect()`.

Do not send ERG or resistance targets that the connected trainer did not advertise. Test new hardware behavior at low resistance on an unoccupied bike. An application must always expose an obvious stop control and handle disconnect/error events.

All command methods reject with typed `FtmsError` subclasses for protocol, capability, and control failures. Human-readable messages are for diagnostics and may evolve before 1.0.

## Implemented

- Fitness Machine Feature and supported-range discovery
- Indoor Bike Data parsing
- Request control, reset, start, pause and stop
- ERG target power
- Manual resistance level
- Indoor-bike simulation parameters
- Serialized control-point procedures with timeouts
- Serialized browser GATT operations
- Dependency-free reactive state and stream transforms
- Real Web Bluetooth and simulated transports

## Deliberately deferred

- Firmware updates and factory procedures
- Physical spindown calibration
- Vendor-specific Wahoo and Zwift services
- ANT+
- Heart-rate sensor pairing

The library is capability-driven. Applications should check the object returned by `connect()` instead of assuming every trainer implements every FTMS feature.

## Development and support

The repository runs strict TypeScript checks, unit and behavioral tests, NodeNext and bundler consumer compilation, `publint`, Are the Types Wrong, and an installed-tarball runtime smoke test before publishing.

- [Repository and Trainer Lab](https://github.com/cemergin/open-trainer-ftms)
- [Issue tracker](https://github.com/cemergin/open-trainer-ftms/issues)
- [Security policy](https://github.com/cemergin/open-trainer-ftms/security/policy)
- [Contributing guide](https://github.com/cemergin/open-trainer-ftms/blob/main/CONTRIBUTING.md)
