# @open-trainer/ftms

A small, transport-independent TypeScript library for reading and controlling Bluetooth FTMS smart trainers. The initial hardware target is Wahoo KICKR CORE firmware 1.1.1 or newer.

## Public API

```ts
import { createWebBluetoothTrainer } from "@open-trainer/ftms/web-bluetooth";

const trainer = createWebBluetoothTrainer();
trainer.telemetry.subscribe((sample) => {
  if (sample) console.log(sample.instantaneousPowerWatts);
});

const capabilities = await trainer.connect();
await trainer.acquireControl();
await trainer.setTargetPower(140);
await trainer.start();
```

`connect()` must be called from a user gesture when the Web Bluetooth device chooser is required.

Current state is synchronously available while subscriptions receive the initial value and future changes:

```ts
console.log(trainer.connection.current);

const unsubscribe = trainer.connection.subscribe((state) => {
  console.log(state);
});

unsubscribe();
```

The root package exposes the stable trainer model. Browser, testing, transport-extension, and raw-protocol APIs use explicit subpath imports.

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
