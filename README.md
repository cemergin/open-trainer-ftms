# Open Trainer — just ride

[![CI](https://github.com/cemergin/open-trainer-ftms/actions/workflows/ci.yml/badge.svg)](https://github.com/cemergin/open-trainer-ftms/actions/workflows/ci.yml)

A free desktop cycling companion for Bluetooth FTMS smart trainers. Choose from seven workouts, let the app suggest a starting power or choose your own, and ride with live power guidance, speed, cadence, and interval progress. The app keeps the last 30 rides and an unfinished-ride checkpoint in this browser.

The workspace contains the independent `@open-trainer/ftms` library and a TypeScript/Vite riding app. The rebuilt Trainer Lab at `/lab.html` provides detailed telemetry, capability inspection, individual controls, and downloadable diagnostics. Desktop is the current priority; mobile-specific polish and phone trainer testing are deferred.

## Requirements

- Node.js 22.12+ (22.x), 24.x, or 26+ for workspace development
- npm 10.9 or newer
- Chrome or Edge for a real trainer
- A secure context: HTTPS in production or `localhost` during development
- An ERG-capable trainer advertising standard Bluetooth FTMS; the rider's trainer is a Wahoo KICKR CORE

## Ride locally

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:4173` in Chrome or Edge on this computer. Choose **Try a demo** to test a simulated ride without hardware, or **Connect trainer** to pair your bike trainer. Bluetooth pairing needs a browser button click; the app does not connect or apply resistance automatically.

Choose **Steady ride**, **Five efforts**, **Recovery spin**, **Tempo cruise**, **Rolling hills**, **Mountain climb**, or **Free ride**. Hills and mountain are ERG power profiles, not simulated routes or slope control. Leave **Steady target** empty for Auto, or enter a comfortable watt target. Auto uses a conservative preset and may lower it using a previous completed physical ride's average power; it does not measure or estimate FTP.

The presets use general warm-up, main-effort, and cool-down patterns rather than personalized training prescriptions.

Start pedaling and press **Start ride**. With no ride history, the default is a 30-minute steady ride with a 60 W warm-up, 100 W middle, and 50 W cool-down. You can adjust power during the ride. Targets follow the trainer's supported range and increment, with an app ceiling of 600 W.

- **Pause ride / Resume ride** excludes breaks from workout time.
- **End ride**, or Escape, sends Stop and saves the partial ride. Timed workouts stop automatically at the finish.
- The power gauge combines color and text for below target, **In the pocket**, and above target. Trainer speed and subtle movement provide live feedback; missing or stale data never counts as on target. Reduced-motion preferences disable animation.
- The app pauses on stale telemetry, detected browser suspension, or sustained near-zero cadence when cadence is reported. It cannot command a disconnected trainer or guarantee physical resistance release without an acknowledged Stop.
- Keep this tab open and the computer awake. Screen wake lock is requested when supported. Checkpoints save every five seconds of recorded riding and on lifecycle/page-exit events. After returning, reconnect through the recovery card, then explicitly choose **Resume ride**. Recovery restores the recorded time, workout, adjustment, samples, and measurements in a paused state; time away is excluded.
- **Past rides** keeps the last 30 rides. Each ride can be downloaded as CSV, and **Export all data** creates a JSON backup including the recovery checkpoint. CSV contains per-second samples; it is not a FIT/TCX file or a Strava upload. Distance is estimated from trainer speed; work is mechanical kJ, not dietary calories. Simulator data is labeled separately.

Persistence runs through the app's storage service using browser local storage. No account, cloud upload, cookies, or subscription is required. Records belong to this browser and site address, so localhost and a hosted site have separate histories. Browser data can be cleared; export a backup to keep it. Physical KICKR CORE pairing and resistance response still require a real session.

Open the [live ride app](https://cemergin.github.io/open-trainer-ftms/) on free GitHub Pages hosting over HTTPS. See [GITHUB_PAGES.md](./GITHUB_PAGES.md) to publish updates; local use does not require publication.

## Verify the workspace

```sh
npm test
npm run typecheck
npm run build
npm run verify:package
```

The latest local validation passed 107 tests (86 app and 21 library), type checking, production build, and package verification.

The library follows a test-first workflow. Its suite covers FTMS packet codecs, reactive state behavior, GATT operation serialization, FTMS command sequencing, trainer state transitions, and package export boundaries. App tests cover workout profiles, recovery and command races, power feedback, history/checkpoint validation, and diagnostic controls.

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

## First real-trainer session

1. Check the KICKR CORE firmware in Wahoo's app, then fully close Wahoo, Zwift, and other trainer applications.
2. Put the bike on the trainer, plug in the trainer, and open `http://127.0.0.1:4173` in Chrome or Edge.
3. Choose **Connect trainer**, allow Bluetooth access, and select the FTMS trainer.
4. Choose a workout and leave the target on Auto or select a comfortable low target. Start pedaling, then choose **Start ride**.
5. Confirm that power/cadence appear and that **Pause ride** and **End ride** work with your hardware.
6. Use [Trainer Lab](http://127.0.0.1:4173/lab.html) for device capabilities, ranges, detailed telemetry, a recent power/cadence chart, control responses, machine-status packets, and downloadable snapshots/session logs. Its 80 W demo sequence is simulator-only. End the ride before opening the lab.

If a trainer is missing from the chooser, check firmware, Bluetooth permissions, and other apps holding a connection. The riding screen requires ERG power control; the diagnostic lab exposes other supported control modes.

## Package architecture

The trainer core depends on the small `FtmsTransport` port. The included adapters are:

- `WebBluetoothFtmsTransport` for physical BLE hardware.
- `MockFtmsTransport` for the riding app, lab, and unit tests.

The riding app and any future game consume the package's public telemetry and control API. They do not parse Bluetooth packets or access GATT characteristics directly.

```ts
import type { Trainer } from "@open-trainer/ftms";
import { createWebBluetoothTrainer } from "@open-trainer/ftms/web-bluetooth";
import { createMockTrainer } from "@open-trainer/ftms/testing";
```

Reactive data flows out through read-only state and streams. Async commands flow in through serialized queues. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the boundaries, TDD strategy, and remaining hardware-validation plan.

## Next phase

Validate the ride lifecycle on the KICKR CORE and follow [GITHUB_PAGES.md](./GITHUB_PAGES.md) to publish the static app. The trainer library remains independent and publishable. See [PLAN.md](./PLAN.md) for implementation and review status.
