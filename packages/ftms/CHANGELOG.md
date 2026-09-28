# @open-trainer/ftms

## 0.2.0

### Minor Changes

- c64eac0: Add a sensors entry point for standard Bluetooth heart-rate, crank-cadence, and cycling-power measurements with freshness, optional battery discovery, and mock sensors. Add capability-gated target cadence and spin-down commands, decoded Machine Status parameters, and command timing events. Extend testing utilities with bounded transport recording, validated offline replay, and explicit one-shot fault injection. Hardware qualification remains separate from simulator and replay verification.
- 0199a2f: Harden the public API and runtime for production use: stable error codes, typed machine-status events, distinct lifecycle state notifications, spec-correct resistance telemetry and supported-range decoding, FTMS 1.0/1.0.1 resistance-command compatibility, timeout quarantine, setpoint coalescing, safety-command priority, idempotent connection lifecycles, strict capability discovery, isolated subscribers, and safer Web Bluetooth cleanup. Add enforced lint, formatting, coverage, package, security, release, and source-fingerprinted physical-hardware gates, plus a guided Trainer Lab qualification and report-export workflow.

### Patch Changes

- 37915d6: Preserve the Web Bluetooth type reference in declarations emitted by TypeScript 7 so package consumers resolve BluetoothDevice without extra configuration.
