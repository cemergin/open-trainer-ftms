# Open Trainer library architecture and TDD plan

## Stable contract

Applications depend on the semantic `Trainer` API: normalized capabilities, state, telemetry, and control methods. They do not depend on BLE UUIDs, packet offsets, browser objects, or command timing.

The package uses explicit entry points:

- `@open-trainer/ftms` — stable trainer types, errors, read-only reactive primitives, and transforms.
- `@open-trainer/ftms/web-bluetooth` — browser adapter and factory.
- `@open-trainer/ftms/testing` — simulator and test utilities.
- `@open-trainer/ftms/transport` — adapter-author extension point.
- `@open-trainer/ftms/raw` — low-level FTMS codecs and UUIDs.

The implementation follows ports and adapters:

```text
application → Trainer API → FTMS core → transport port → Web Bluetooth
                                               └──────→ simulator
                                               └──────→ future native BLE
```

## Data and control model

Data flowing out is reactive:

- `StateValue<T>` provides synchronous `.current` state and immediate/future subscription updates.
- `Stream<T>` represents transient events without pretending they have a current value.
- Public reactive objects are read-only at runtime as well as in TypeScript.
- Telemetry becomes `null` on disconnect so consumers cannot mistake stale watts for live output.

Commands flowing in are asynchronous and serialized:

1. The browser transport serializes GATT reads, writes, and notification setup.
2. The FTMS Control Point queue permits one request/indication procedure at a time.
3. A future setpoint scheduler will rate-limit and coalesce high-frequency game targets.

Connection, control ownership, and trainer activity are separate states. A trainer can therefore remain connected after control is revoked or remain controlled while paused.

## TDD layers

### Implemented

- Pure command-encoding tests.
- Pure packet-decoding and capability tests.
- Read-only state, current-value, subscription, map/filter/distinct tests.
- Generic async-operation serialization tests.
- FTMS request/response ordering tests with delayed simulated indications.
- Trainer connection, control, activity, telemetry, and failure tests.
- Package entry-point and publishing-metadata contract tests.

### Next without physical hardware

1. Add a service-qualified GATT address type so FTMS and Cycling Power Service can coexist.
2. Define setpoint coalescing outcomes before implementation: applied, superseded, rejected, and timed out.
3. Add stop-priority tests while preserving the one-in-flight FTMS rule.
4. Parse Machine Status into typed control-revocation and target-change events.
5. Add stable error codes and test them; human-readable messages will not be API contracts.
6. Add reconnect tests covering permission reuse, queue cleanup, and stale-state reset.
7. Add packet-capture replay fixtures with identifying device data removed.
8. Add consumer compilation fixtures for TypeScript `bundler` and `nodenext` resolution.

### Requires hardware

Run the same contract suite or recorded-session procedure against:

1. Wahoo KICKR CORE on current firmware.
2. A second FTMS brand such as Tacx or Elite.
3. A trainer advertising partial FTMS capabilities.

For each device record feature flags, characteristic availability, notification rate, command responses, disconnect behavior, ERG response, resistance behavior, and simulation behavior. Hardware observations become fixtures and compatibility profiles; model-name conditionals do not enter the core casually.

## Packaging work remaining

- Add `publint` and `@arethetypeswrong/cli` to CI when the project has its permanent repository.
- Test the packed tarball in small Vite and Node-resolution consumer fixtures.
- Publish through npm trusted publishing with provenance once the package name and release workflow are finalized.
- Keep the version below `1.0.0` until the public API survives real sessions on at least two trainer families.
