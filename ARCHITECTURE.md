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
3. A timed-out opcode is quarantined until its late indication is discarded, preventing a stale response from completing a later command.
4. Queued setpoints coalesce, while pause, stop, and reset overtake and cancel queued targets.
5. A future application scheduler may rate-limit setpoints before they reach the library.

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
- Stable error-code, malformed-packet, timeout-quarantine, and connection-race tests.
- Web Bluetooth tests with a fake GATT stack covering picker, connection, notification, cleanup, and failure behavior.
- Typed Machine Status and FTMS 1.0/1.0.1 resistance-encoding tests.
- Enforced coverage thresholds, clean tarball installation, and runtime import smoke tests.

### Next without physical hardware

1. Add a service-qualified GATT address type so FTMS and Cycling Power Service can coexist.
2. Define application-level setpoint scheduling outcomes beyond the library's `command_superseded`, rejection, and timeout errors.
3. Parse typed payloads for target-change Machine Status events; unknown payloads are already preserved.
4. Add packet-capture replay fixtures with identifying device data removed.
5. Add deterministic property/fuzz tests for flag combinations and truncated packets.

### Requires hardware

Run the same contract suite or recorded-session procedure against:

1. Wahoo KICKR CORE on current firmware.
2. A second FTMS brand such as Tacx or Elite.
3. A trainer advertising partial FTMS capabilities.

For each device record feature flags, characteristic availability, notification rate, command responses, disconnect behavior, ERG response, resistance behavior, and simulation behavior. Hardware observations become fixtures and compatibility profiles; model-name conditionals do not enter the core casually.

## Release work remaining

- Qualify the Wahoo KICKR CORE and commit the required sanitized evidence.
- Create or confirm the npm scope and configure trusted publishing for the protected `npm` environment.
- Validate the first registry-published version from a fresh browser application in addition to the installed-tarball Node smoke test.
- Keep the version below `1.0.0` until the public API survives real sessions on at least two trainer families.

## Local ride application

The desktop ride application imports trainer factories, shared trainer types, persistence, and browser capabilities through `apps/trainer-lab/src/services/index.ts`. Vendor adapter imports stay behind this entry point. `workout.ts` defines seven pure ERG plans, conservative starting-target suggestions, and range-aware targets; hills/mountain change power rather than route slope. `ride.ts` owns the workout clock, command lifecycle, recovery, and per-second samples. `main.ts` coordinates UI state, while focused modules under `src/ui/` render workout choices, power feedback, and history.

`Ride.restore()` validates a checkpoint and restores a paused ride without sending hardware commands or adding time away. It preserves the original timestamp, samples, distance, work, and measured power duration; the optional `measuredSeconds` record field keeps new checkpoints exact while supporting older records. Resume obtains control when necessary before sending the target and Start. Paused target adjustments remain local until Resume.

`storage.ts`, exposed through the service boundary, uses browser local storage for the last 30 rides and one unfinished-ride checkpoint. Checkpoints include the workout, ride record, power adjustment, and save timestamp. The app saves every five seconds of recorded riding and on lifecycle/page-exit events, then offers explicit reconnect and Resume after returning. Completed or explicitly ended rides enter history; the rider can also archive an unfinished recovery as a partial ride. Per-ride CSV and a JSON data backup are downloadable. There are no cookies, accounts, cloud sync, or server-side persistence. Storage is scoped to the browser's site origin.

The rebuilt Lab uses the same FTMS API and UI system. It displays detailed telemetry, freshness, recent power/cadence, capabilities, supported ranges, control responses, and machine-status packets. `lab-diagnostics.ts` owns diagnostic command sequencing and the simulator-only 80 W sequence. The reusable qualification panel records physical-only counters and saves draft notes through the service entry point. Changes of device, client metadata, or resistance encoding clear previous pass marks and counts; changed runtimes discard old draft observations. The panel exports a source/build/dependency-fingerprinted hardware report only after all checks pass. Snapshots expose the package version, commit, and fingerprint, and session logs can be exported; reconnect and control errors remain visible rather than being inferred as successful hardware actions.

UI tokens, native component styles, and layout styles are separate layers. See [DESIGN.md](./DESIGN.md) for their contracts. Desktop is the present product target, with mobile-specific work deferred. The app uses no frontend framework or backend. The static build supports GitHub Pages hosting over HTTPS; see [GITHUB_PAGES.md](./GITHUB_PAGES.md) for publication and hosted verification.

Run `npm run verify` for the combined library/app checks. Coverage produces native JSON for Codeflow; unsupported analyzer input is reported as unavailable rather than converted to an estimated score.
