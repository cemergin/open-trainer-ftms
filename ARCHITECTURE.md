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
- Workout profiles, command/End races, cadence and sleep pauses, recovery, exact measured-duration preservation, and power-feedback tests.
- Ride history/checkpoint validation, CSV/JSON export, service boundaries, and diagnostic-control tests.

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

The rider uses a Wahoo KICKR CORE. Physical validation is still pending; simulator success does not establish a device's response. Run the same contract suite or recorded-session procedure against:

1. Wahoo KICKR CORE on current firmware.
2. A second FTMS brand such as Tacx or Elite.
3. A trainer advertising partial FTMS capabilities.

For each device record feature flags, characteristic availability, notification rate, command responses, disconnect behavior, ERG response, resistance behavior, and simulation behavior. Hardware observations become fixtures and compatibility profiles; model-name conditionals do not enter the core casually.

## Packaging work remaining

- Publish through npm trusted publishing with provenance once the package name and release workflow are finalized.
- Validate the first registry-published version from a fresh browser application in addition to the installed-tarball Node smoke test.
- Keep the version below `1.0.0` until the public API survives real sessions on at least two trainer families.

## Local ride application

The desktop ride application imports trainer factories, shared trainer types, persistence, and browser capabilities through `apps/trainer-lab/src/services/index.ts`. Vendor adapter imports stay behind this entry point. `workout.ts` defines seven pure ERG plans, conservative starting-target suggestions, and range-aware targets; hills/mountain change power rather than route slope. `ride.ts` owns the workout clock, command lifecycle, recovery, and per-second samples. `main.ts` coordinates UI state, while focused modules under `src/ui/` render workout choices, power feedback, and history.

`Ride.restore()` validates a checkpoint and restores a paused ride without sending hardware commands or adding time away. It preserves the original timestamp, samples, distance, work, and measured power duration; the optional `measuredSeconds` record field keeps new checkpoints exact while supporting older records. Resume obtains control when necessary before sending the target and Start. Paused target adjustments remain local until Resume.

`storage.ts`, exposed through the service boundary, uses browser local storage for the last 30 rides and one unfinished-ride checkpoint. Checkpoints include the workout, ride record, power adjustment, and save timestamp. The app saves every five seconds of recorded riding and on lifecycle/page-exit events, then offers explicit reconnect and Resume after returning. Completed or explicitly ended rides enter history; the rider can also archive an unfinished recovery as a partial ride. Per-ride CSV and a JSON data backup are downloadable. There are no cookies, accounts, cloud sync, or server-side persistence. Storage is scoped to the browser's site origin.

The rebuilt Lab uses the same FTMS API and UI system. It displays detailed telemetry, freshness, recent power/cadence, capabilities, supported ranges, control responses, and machine-status packets. `lab-diagnostics.ts` owns diagnostic command sequencing and the simulator-only 80 W sequence. Snapshots and session logs can be exported; reconnect and control errors remain visible rather than being inferred as successful hardware actions.

UI tokens, native component styles, and layout styles are separate layers. See [DESIGN.md](./DESIGN.md) for their contracts. Desktop is the present product target, with mobile-specific work deferred. The app uses no frontend framework or backend. The static build supports GitHub Pages hosting over HTTPS; see [GITHUB_PAGES.md](./GITHUB_PAGES.md) for publication and hosted verification.

The latest local validation passed 106 tests (85 app and 21 library), type checking, production build, and package verification. Final Codeflow assessment found no material cleanup candidates; missing analyzer artifacts are recorded privately as unavailable rather than replaced by estimated scores.
