# Training expansion

Build on the merged desktop app while preserving local data and the single service boundary.

## Implementation order

1. Extend the FTMS library: decoded status values, command lifecycle diagnostics, capability-gated cadence/spindown, and recording/replay/fault injection.
2. Add optional heart-rate, cadence, and power sensors with explicit data-source selection and stale-data handling.
3. Add workout editing, ramps/repeats, saved profiles, JSON import/export, and FIT activity export.
4. Extend the ride engine and UI with ERG/resistance/terrain modes, interval controls, coaching, route progress, and comparable ghost rides.
5. Add ride analysis and local backup import/merge/storage management.
6. Integrate the new diagnostics into Trainer Lab, run the complete verification pipeline, self-review the combined changes, and exercise the app in the internal browser.

## Design

Keep the existing dark palette, shared tokens, large ride controls, and restrained motion. Put ride mode and current target beside the live measurements. Show a compact elevation route only for terrain rides. Keep workout editing, sensors, analysis, and data management in expandable panels so the ride remains the focus. Every simulated source and unavailable hardware capability must be labelled.

## Acceptance

- Existing ride/history/checkpoint data remains readable; recovery preserves the selected control mode and route.
- Unsupported controls cannot be sent; Stop remains available during queued commands.
- Selected external sensor loss is visible and never silently replaced by another source.
- Imported workouts/backups/traces are bounded and validated before changing state.
- Activity exports decode successfully with the official FIT SDK.
- Ghosts compare the same route and simulated/physical source category; missing data remains missing.
- Browser tests cover the new flows and no unhandled errors; physical qualification is reported separately.
- Strict lint, formatting, types, coverage, package verification, and Codeflow review remain enabled.

## Delivered and verified

- Implemented the six workstreams above, including visible screen wake-lock status, retry backoff, and reacquisition after returning to the tab.
- 243 library tests, 212 app tests, and 12 release-gate tests pass. Strict formatting/lint, app types, production builds, and isolated package checks pass with the existing thresholds.
- Added the live power/heart-rate chart with a two-minute active-time window, labelled scales, an ERG target trace, pause/recovery support, and missing-data gaps.
- Low cadence now shows a 20-second auto-pause countdown. Pedaling cancels it, missing cadence is not treated as zero, and resuming starts a fresh countdown if needed.
- Internal-browser checks exercised terrain adjustments, skip/extend, pause/resume, closing/reopening recovery, saved analysis, a custom ramp/repeated workout, external demo heart rate, Lab cadence/spin-down diagnostics, offline replay, and fault handling.
- Independent reviews fixed stop/calibration ordering, interleaved replay notifications, fault occurrence counting, stale sensor cleanup, resistance rounding, source provenance/recovery, and backup overwrite risks.
- Codeflow quality review and its narrow cleanup pass completed. Complexity and erosion were measured with installed parsers. CRAP remains unavailable because its coverage adapter rejects Vitest's null function-end columns; no coverage estimates or thresholds were substituted. Verbosity tooling was unavailable.

## Practical limits

- These checks use simulated hardware. Physical trainer and sensor qualification remains necessary; the existing stable-release evidence gate stays enabled.
- Screen wake lock depends on browser support, visibility, and power policy. The status reports whether it was acquired; closing the tab or sleeping the computer can still interrupt a session.
- Terrain is a synthetic grade profile, with distance estimated from trainer speed. Ghosts require matching route IDs and simulated/physical categories.
- FIT exports use active ride time and omit pauses. Ride backups merge local history and recovery; workout favorites have separate JSON export/import. Up to 100 rides are retained subject to browser storage quota, with explicit save errors and backup controls.
