# Open Trainer — just ride

[![CI](https://github.com/cemergin/open-trainer-ftms/actions/workflows/ci.yml/badge.svg)](https://github.com/cemergin/open-trainer-ftms/actions/workflows/ci.yml)

A free desktop cycling companion for Bluetooth FTMS smart trainers. Ride with ERG power targets, manual resistance, or simulated terrain. Choose a preset or build a workout with repeated intervals and ramps, connect separate sensors, and compare your rides locally. The app keeps the last 100 rides and an unfinished-ride checkpoint in this browser.

The workspace contains the independent `@open-trainer/ftms` library and a TypeScript/Vite riding app. The rebuilt Trainer Lab at `/lab.html` provides detailed telemetry, capability inspection, individual controls, and downloadable diagnostics. Desktop is the current priority; mobile-specific polish and phone trainer testing are deferred.

## Requirements

- Node.js 22.13+ (22.x), 24.x, or 26+ for workspace development
- npm 10.9 or newer
- Chrome or Edge for a real trainer
- A secure context: HTTPS in production or `localhost` during development
- A trainer advertising standard Bluetooth FTMS and the capability required by the selected ride mode; the rider's trainer is a Wahoo KICKR CORE

## Ride locally

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:4173` in Chrome or Edge on this computer. Choose **Try a demo** to test a simulated ride without hardware, or **Connect trainer** to pair your bike trainer. Bluetooth pairing needs a browser button click; the app does not connect or apply resistance automatically.

Choose **Steady ride**, **Five efforts**, **Recovery spin**, **Tempo cruise**, **Rolling hills**, **Mountain climb**, or **Free ride**. The hills and mountain presets describe power profiles; select **Terrain** under **Ride control** to send simulated slope commands. Leave **Steady target** empty for Auto, or enter a comfortable watt target. Auto uses a conservative preset and may lower it using a previous completed physical ride's average power; it does not measure or estimate FTP.

**Ride control** offers the modes your connected trainer supports:

- **ERG** follows the workout's watt targets, including ramps.
- **Resistance** holds a resistance level; your gearing and cadence determine power.
- **Terrain** changes grade with estimated distance along a local route. Select a previous ride on the same route and with the same simulator/physical source for a ghost comparison. Routes loop, and a ghost ends when its recorded activity ends.

The presets use general warm-up, main-effort, and cool-down patterns rather than personalized training prescriptions.

Turn on **Spice things up** for a timed ERG preset to vary its hills, ramps, peaks, and recoveries. **Shuffle** chooses the next repeatable mix; each preset remembers its mix while the page is open. The duration, warm-up, and cool-down stay intact, and recovery rides remain gentle. Preview the profile before starting: the chosen mix stays fixed during the ride and is saved with its recovery checkpoint. Use **Edit workout** to save a mix as a favorite. Free rides, terrain/resistance modes, and custom workouts do not apply Spice.

Start pedaling and press **Start ride**. With no ride history, the default is a 30-minute steady ride with a 60 W warm-up, 100 W middle, and 50 W cool-down. You can adjust power during the ride. Targets follow the trainer's supported range and increment, with an app ceiling of 600 W.

- **Pause ride / Resume ride** excludes breaks from workout time.
- **Skip interval** advances the workout without adding activity time, distance, or work. **Extend interval** adds time to the current block; recovery preserves the edited workout and its position separately from actual ride time.
- **End ride**, or Escape, sends Stop and saves the partial ride. Timed workouts stop automatically at the finish.
- The power gauge combines color and text for below target, **In the pocket**, and above target. Trainer speed and subtle movement provide live feedback; missing or stale data never counts as on target. Reduced-motion preferences disable animation.
- **Your live rhythm** plots the latest two minutes of recorded power and heart rate on labelled scales, with a dashed target in ERG mode. It freezes during pauses, returns with recovered rides, and leaves missing sensor readings blank. Choose a heart-rate source under **Sensors** to see BPM.
- The app shows a 20-second auto-pause countdown when reported cadence drops below 20 rpm. Pedaling at 20 rpm or more cancels it; absent cadence does not count as stopped pedaling. After an automatic pause, press **Resume ride** to continue. Stale telemetry and detected browser suspension still pause separately. The app cannot command a disconnected trainer or guarantee physical resistance release without an acknowledged Stop.
- The app requests a screen wake lock during a session and shows whether it is active. Browsers may refuse or release it, and hidden tabs cannot keep the screen awake. Requests back off after denial and retry when the tab becomes visible or a new session begins. Keep the ride tab visible; this cannot prevent system sleep in unsupported browsers or while the computer is closed.
- Checkpoints save every five seconds of recorded riding and on lifecycle/page-exit events. After returning, reconnect through the recovery card, then explicitly choose **Resume ride**. Recovery restores the mode, recorded time, workout, source selection, adjustments, samples, and measurements in a paused state; time away is excluded. Pair external sensors again when needed.
- **Past rides** keeps the last 100 rides. Download a ride as CSV or FIT, inspect its analysis, or delete it. A ride with an active recovery checkpoint must be recovered or archived before deletion. Distance is estimated from trainer speed; work is mechanical kJ, not dietary calories. Simulator data is labeled separately.

## Workouts, sensors, and data

Open **Workout studio** to add, remove, or reorder blocks. A block can repeat a group of steps; each step has duration, start watts, optional ramp end watts, and optional cadence guidance. Choose **Use this workout** to select it, or **Save favorite** to retain it on this device. Import/export workout JSON preserves repeats and ramps. Favorites are separate from ride backups; export them from the studio.

Under **Sensors**, pair a standard Bluetooth Heart Rate, Cycling Speed and Cadence (crank cadence), or Cycling Power sensor. Select trainer, external, or no source independently for power, cadence, and heart rate. Stale external readings become missing values rather than silently switching to the trainer. Demo and physical sources cannot be mixed in a session. Source changes are retained in ride backups and identified in expanded CSV exports.

**Ride analysis** reports power zones relative to a reference FTP, peak power, cadence variation, and time on target for ERG rides. Missing samples and gaps are excluded. Optional coaching cues can be enabled in the riding screen.

FIT activity export uses the [official Garmin JavaScript SDK](https://github.com/garmin/fit-javascript-sdk). It includes timestamped measurements and lap/session/activity summaries; missing measurements remain absent. The exported timeline uses **active ride time**: pause wall time is not recorded or reconstructed. FIT workout import/export and direct uploads to activity services are not included; workout exchange uses JSON.

**Export ride backup** saves versioned JSON including the recovery checkpoint. **Merge ride backup** validates the complete file before writing, preserves longer local records and an existing recovery checkpoint, and reports failures without replacing saved data. The import limit is 20 MB and 100 rides; browser storage quotas may be lower. Keep a downloaded backup before clearing browser data.

Persistence runs through the app's storage service using browser local storage. No account, cloud upload, cookies, or subscription is required. Records belong to this browser and site address, so localhost and a hosted site have separate histories. Browser data can be cleared; export a backup to keep it. Physical KICKR CORE pairing and resistance response still require a real session.

Open the [live ride app](https://cemergin.github.io/open-trainer-ftms/) on free GitHub Pages hosting over HTTPS. See [GITHUB_PAGES.md](./GITHUB_PAGES.md) to publish updates; local use does not require publication.

## Verify the workspace

```sh
npm run verify
```

Verification includes strict typed lint, formatting, library coverage thresholds, all app tests, release-gate tests, type checking, production builds, and a clean packed-package consumer. TypeScript 7 performs compilation; Microsoft’s TypeScript 6 compatibility API supplies typed ESLint until its TS7 compiler API is available.

The library follows a test-first workflow. Its suite covers FTMS and sensor packet codecs, freshness, reactive state, GATT serialization, FTMS command sequencing, trace replay, fault injection, trainer state transitions, and package export boundaries. App tests cover ride modes, workout editing, independent activity/workout clocks, recovery, source attribution, backup transactions, analysis, wake locks, and SDK-decoded FIT exports.

## Manual npm release

The **Publish npm package** GitHub Action is manual and defaults to a dry run. It installs dependencies from the lockfile, runs the complete test/type/build suite, and verifies the package archive before any publish step can execute.

For a real release:

1. Merge the Changesets-generated version pull request described below. npm versions cannot be overwritten.
2. In the npm package settings, configure a GitHub Actions trusted publisher for user `cemergin`, repository `open-trainer-ftms`, workflow file `publish.yml`, environment `npm`, and allow the `npm publish` action.
3. Optionally protect the repository's `npm` environment with required reviewers.
4. Open **Actions → Publish npm package → Run workflow**, select `publish`, choose the `next` or `latest` tag, and enter `publish @open-trainer/ftms` exactly.

The workflow uses short-lived OIDC authentication and publishes provenance from a GitHub-hosted runner. If an initial token-authenticated publish is required before npm will let you configure the trusted publisher, add a narrowly scoped automation token as the `NPM_TOKEN` secret on the `npm` environment, publish once, then remove the secret after trusted publishing is configured.

See npm's [trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) for the one-time registry configuration.

## Versioning and changelogs

Published versions are managed with [Changesets](https://github.com/changesets/changesets):

1. For a user-visible library change, run `npm run changeset` in the feature branch.
2. Select `@open-trainer/ftms`, choose the semantic version impact, and write a short user-facing summary.
3. Commit the generated `.changeset/*.md` file with the pull request.
4. After changes land on `main`, the **Version packages** action creates or updates one version pull request containing the calculated package version, lockfile, and changelog changes.
5. Merge that version pull request when ready, then use the manual npm release workflow above.

Changesets combine multiple pending entries and apply the highest required bump. Documentation, tests, CI, and unpublished Trainer Lab changes do not need a changeset. The versioning bot never publishes to npm.

## Device qualification and release gates

Trainer Lab includes the guided 12-step physical qualification panel, with persistent draft notes, fresh session counters, supported resistance-command encodings, and sanitized report export. Simulator activity never qualifies physical hardware. Metadata changes and changed device names reset physical evidence; reconnect only the same physical trainer during one report, since device names are not unique identifiers.

Stable npm publishing stays blocked until a physical report matches the source, build configuration, and locked dependency fingerprint. The `next` channel supports hardware evaluation. This npm gate does not block local rides or GitHub Pages. See [DEVICE_INTEGRATION_GUIDE.md](./DEVICE_INTEGRATION_GUIDE.md), [HARDWARE_VALIDATION.md](./HARDWARE_VALIDATION.md), and [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md).

## First real-trainer session

1. Check the KICKR CORE firmware in Wahoo's app, then fully close Wahoo, Zwift, and other trainer applications.
2. Put the bike on the trainer, plug in the trainer, and open `http://127.0.0.1:4173` in Chrome or Edge.
3. Choose **Connect trainer**, allow Bluetooth access, and select the FTMS trainer.
4. Choose a workout and leave the target on Auto or select a comfortable low target. Start pedaling, then choose **Start ride**.
5. Confirm that power/cadence appear and that **Pause ride** and **End ride** work with your hardware.
6. Use [Trainer Lab](http://127.0.0.1:4173/lab.html) for device capabilities, ranges, detailed telemetry, a recent power/cadence chart, command timing, machine-status packets, and downloadable snapshots/session logs. Export a raw trace for offline replay; incomplete recordings cannot be replayed. Its 80 W demo sequence and fault scenarios use the simulator. End the ride before opening the lab.

If a trainer is missing from the chooser, check firmware, Bluetooth permissions, and other apps holding a connection. Choose a ride mode that the connected trainer advertises. Software tests and replay do not establish physical KICKR CORE qualification.

## Package architecture

The trainer core depends on the small `FtmsTransport` port. The included adapters are:

- `WebBluetoothFtmsTransport` for physical BLE hardware.
- `MockFtmsTransport` for the riding app, lab, and unit tests.
- `RecordingFtmsTransport`, `ReplayFtmsTransport`, and `FaultInjectionFtmsTransport` for explicit diagnostics and offline tests.

The riding app and any future game consume the package's public telemetry and control API. They do not parse Bluetooth packets or access GATT characteristics directly.

```ts
import type { Trainer } from "@open-trainer/ftms";
import { createWebBluetoothTrainer } from "@open-trainer/ftms/web-bluetooth";
import { createMockTrainer } from "@open-trainer/ftms/testing";
import { createWebBluetoothSensor, createMockSensor } from "@open-trainer/ftms/sensors";
```

Reactive data flows out through read-only state and streams. Async commands flow in through serialized queues. See the [package README](./packages/ftms/README.md) for sensor and trace examples, and [ARCHITECTURE.md](./ARCHITECTURE.md) for the boundaries and remaining hardware-validation plan.

## Next phase

Validate the ride lifecycle on the KICKR CORE and follow [GITHUB_PAGES.md](./GITHUB_PAGES.md) to publish the static app. The trainer library remains independent and publishable. See [PLAN.md](./PLAN.md) for implementation and review status.
