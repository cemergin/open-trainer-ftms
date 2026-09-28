# Open Trainer — just ride

[![CI](https://github.com/cemergin/open-trainer-ftms/actions/workflows/ci.yml/badge.svg)](https://github.com/cemergin/open-trainer-ftms/actions/workflows/ci.yml)

A free, open-source desktop cycling app for Bluetooth FTMS smart trainers. Built toward a subscription-free alternative to Zwift for indoor workouts: set your effort, follow a ride, and keep your data on your own device.

**[Start riding →](https://cemergin.github.io/open-trainer-ftms/)** · **[Open Trainer Lab](https://cemergin.github.io/open-trainer-ftms/lab.html)** · **[FTMS library documentation](./packages/ftms/README.md)**

No account, subscription, or installation is needed for the hosted app. Try the simulator without hardware, or connect a compatible trainer in desktop Chrome or Edge. Desktop is the current focus; phone trainer testing is deferred. Physical KICKR CORE qualification is still pending.

## Your first ride

1. Open the [ride app](https://cemergin.github.io/open-trainer-ftms/) in desktop Chrome or Edge.
2. Choose **Try a demo**, or power on your trainer, close other apps using it, and choose **Connect trainer**. Pairing requires your button click and browser permission.
3. Pick a workout and duration. Leave **Reference power** on **Auto**, or choose a comfortable starting watt value.
4. Preview the profile, start pedaling, and press **Start ride**. Adjust **Workout intensity** with the large −/+ buttons as you go.
5. Use **Pause ride** for a break or **End ride** to finish and save. Timed workouts finish automatically.

For a physical trainer, use HTTPS or localhost and a device that advertises Bluetooth FTMS and the selected control mode. Start with a low target and confirm telemetry, pause, and stop behavior with your hardware. If pairing fails, check firmware, Bluetooth permissions, and whether Wahoo, Zwift, or another app still holds the connection. End your ride before using Trainer Lab.

## Build a ride that suits today

Choose **15, 20, 30, 40, 45, or 60 minutes**, or take an open-ended **Free ride**.

| Workout        | Ride feel                                             |
| -------------- | ----------------------------------------------------- |
| Steady ride    | A consistent middle effort with warm-up and cool-down |
| Five efforts   | Repeated efforts with recovery between them           |
| Recovery spin  | A gentler session                                     |
| Tempo cruise   | Sustained tempo with changes in effort                |
| Rolling hills  | Alternating climbs and recoveries                     |
| Mountain climb | A longer building effort                              |
| Free ride      | Ride until you choose to finish                       |

### Intensity first

Set reference watts once, then adjust the workout using **50–150% intensity**, in five-point steps. Intensity scales the whole ERG workout, including ramps; the current watt target stays visible. For example, a 100 W reference × a 125% effort × 110% intensity requests about **138 W**. Trainer ranges and increments still apply, with an app ceiling of **600 W**.

**Auto** starts from a conservative preset and may lower it using a previous completed physical ride's average power. It does not measure or estimate FTP. With no ride history, the default 30-minute steady ride starts at 60 W, settles at 100 W, and cools down at 50 W. Presets are general workout patterns, not personalized training prescriptions.

### Season to taste

Turn on **Spice things up** for a timed ERG preset:

- **Mild** smooths the changes.
- **Spicy** adds a balanced mix of hills, ramps, peaks, and recoveries.
- **Hot** adds sharper changes and deeper valleys within the same peak limit.

**Shuffle** chooses another repeatable mix. Duration, warm-up, and cool-down stay intact, and recovery rides remain gentle. The profile stays fixed once the ride begins and is preserved in recovery checkpoints. Each preset remembers its mix while the page is open; use **Edit workout → Save favorite** to keep it. Spice applies to timed ERG presets; free rides, custom workouts, resistance, and terrain use their own controls.

### Choose how the trainer responds

Available modes depend on your trainer's capabilities.

| Mode           | Trainer behavior                                                    |
| -------------- | ------------------------------------------------------------------- |
| **ERG**        | Follows the workout's target power, including ramps                 |
| **Resistance** | Holds a resistance level; gearing and cadence determine your power  |
| **Terrain**    | Changes simulated grade with estimated distance along a local route |

Rolling hills and Mountain climb are power profiles. Choose **Terrain** under **Ride control** to send slope commands. Terrain routes loop, and you can race a ghost from a previous ride on the same route and with the same demo/physical source. A ghost ends when its recorded ride ends.

**Workout studio** lets you create blocks, repeated groups, ramps, and optional cadence cues. Reorder steps, save favorites, or import/export workout JSON. Workout targets must stay within **0–600 W**; optional cadence cues must be **1–250 rpm**. Custom workouts retain their targets and can be scaled with intensity.

## While you ride

- **In the pocket:** a color-and-text power gauge shows whether you are below, on, or above target. Trainer speed and subtle motion provide feedback; missing or stale telemetry never counts as on target. Reduced-motion preferences disable animation.
- **Your live rhythm:** a two-minute power/BPM chart with labelled scales and an ERG target line. It freezes during pauses and returns with recovered rides. Select a heart-rate source under **Sensors** to see BPM.
- **Up next:** the next interval's scaled power, duration, and cadence cue, with a final 10-second highlight and a finish-line card for the last block.
- **Adjust on the go:** change intensity, **Skip interval**, or add **+1 minute**. Skipping does not add activity time, distance, or work. Intensity changes while paused apply on resume.
- **Optional coaching:** enable **Audio cues** and **Speak intervals** independently.
- **Automatic pause:** reported cadence below 20 rpm starts a 20-second countdown. Pedaling at 20 rpm or more cancels it; absent cadence does not count as stopped pedaling. After pausing, choose **Resume ride** explicitly. Stale telemetry and detected browser suspension also pause the session.
- **Keep the screen awake:** the app requests a screen wake lock during a session and displays its status. Keep the tab visible; browser support and permission still apply, and a closed computer cannot stay awake this way.

**End ride**, or Escape, sends Stop and saves the partial ride. Pauses do not count toward activity time. The app cannot command a disconnected trainer or guarantee physical resistance release without an acknowledged Stop.

## Sensors, saved rides, and recovery

Pair separate standard Bluetooth **Heart Rate**, **Cycling Speed and Cadence** (crank cadence), or **Cycling Power** sensors. Choose trainer, external, or no source independently for each metric. Stale external values remain missing instead of silently switching sources. Demo and physical sources cannot be mixed within a session.

Rides and recovery data stay in this browser through the app's storage service. **No cookies or cloud uploads are used.** Different browsers and site addresses have separate histories, including localhost and the hosted app.

- **Resume after an interruption:** checkpoints save every five seconds of recorded riding and on lifecycle/page-exit events. Return to the same browser and site, reconnect through the recovery card, then choose **Resume ride**. The workout, intensity, Spice mix, mode, source choices, samples, and interval edits return paused; time away is excluded. Pair external sensors again when needed.
- **Past rides:** keep the latest **100 rides**, including partial rides. Analyze, compare, export, or delete them. Recover or archive an active checkpoint before deleting its ride. Demo records are labelled separately.
- **Ride analysis:** review power zones against a reference FTP, peak power, cadence variation, and ERG time on target. Missing samples and gaps are excluded. Distance is estimated from trainer speed; work is mechanical kJ, not dietary calories.
- **Activity exports:** download CSV or FIT. FIT uses the [official Garmin JavaScript SDK](https://github.com/garmin/fit-javascript-sdk), includes measurements and lap/session/activity summaries, and uses active ride time; pause wall time is not reconstructed. Direct uploads to activity services and FIT workout exchange are not included.
- **Backups:** **Export ride backup** saves versioned JSON with the recovery checkpoint. **Merge ride backup** validates the complete file before writing, preserves longer local records and an existing checkpoint, and reports failures without replacing saved data. Imports allow up to **20 MB and 100 rides**, subject to browser storage limits. Workout favorites are separate; export them from the studio.

Clearing browser data removes local records. Download backups to keep them or move them to another browser.

## Trainer Lab

[Open Trainer Lab](https://cemergin.github.io/open-trainer-ftms/lab.html) for diagnostics and development:

- Inspect capabilities, supported ranges, decoded telemetry, recent charts, machine-status packets, and command timing.
- Exercise individual trainer controls and download snapshots or session logs.
- Record raw transport traces and replay complete recordings offline while disconnected.
- Run the simulator's 80 W sequence and fault scenarios without hardware.
- Follow the 12-step physical device qualification flow, keep draft notes, and export a sanitized report.

Simulator tests and trace replay do not qualify physical hardware. The first KICKR CORE session and release evidence are tracked in the [device integration guide](./DEVICE_INTEGRATION_GUIDE.md), [hardware validation policy](./HARDWARE_VALIDATION.md), and [production readiness checklist](./PRODUCTION_READINESS.md).

## Run locally

Use Node.js **22.13+ (22.x), 24.x, or 26+** and npm **10.9+**. Node.js 24 is the recommended development toolchain (`nvm use`).

```sh
git clone https://github.com/cemergin/open-trainer-ftms.git
cd open-trainer-ftms
npm ci
npm run dev
```

Open the URL printed by Vite: by default, [the ride app](http://127.0.0.1:4173/) and [Trainer Lab](http://127.0.0.1:4173/lab.html). The development server requires port 4173 to be free. **Try a demo** works without a trainer.

```sh
npm run verify
```

Verification runs formatting, strict typed lint, library coverage checks, app and release-gate tests, type checking, production builds, and a clean packed-package consumer. Library coverage gates require 95% statements, lines, and functions, and 80% branches. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow and toolchain details.

## Package and app architecture

This workspace contains the independently publishable **`@open-trainer/ftms`** library and the **TypeScript/Vite riding app and Trainer Lab**.

The trainer core depends on the small `FtmsTransport` port. Web Bluetooth and mock adapters share the same public trainer API; recording, replay, and fault-injection adapters support diagnostics and tests. Read-only state and streams carry telemetry out, and serialized async commands carry controls in.

```ts
import type { Trainer } from "@open-trainer/ftms";
import { createWebBluetoothTrainer } from "@open-trainer/ftms/web-bluetooth";
import { createMockTrainer } from "@open-trainer/ftms/testing";
import { createWebBluetoothSensor, createMockSensor } from "@open-trainer/ftms/sensors";
```

The app consumes these public APIs through a [single services entry point](./apps/trainer-lab/src/services/index.ts) for trainer adapters, storage, downloads, and browser capabilities. Shared design tokens and components drive the UI. Views do not parse Bluetooth packets or access GATT characteristics directly.

See the [package README](./packages/ftms/README.md) for API examples, [ARCHITECTURE.md](./ARCHITECTURE.md) for boundaries, and [DESIGN.md](./DESIGN.md) for the UI system.

## Publish the app for free

The live app is hosted over HTTPS on GitHub Pages. **Merging into `main` does not automatically publish the site.** From a clean, committed checkout, use the publishing script:

```sh
node scripts/publish-pages.mjs --dry-run
node scripts/publish-pages.mjs
```

The script verifies and builds the app, then publishes the generated site to `gh-pages`. See [GITHUB_PAGES.md](./GITHUB_PAGES.md) for GitHub CLI authentication, permissions, and deployment status checks. App hosting and npm package releases are separate.

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

Stable npm publishing stays blocked until a physical report matches the source, build configuration, and locked dependency fingerprint. The `next` channel supports hardware evaluation. This npm gate does not block local rides or GitHub Pages.

Qualification drafts track fresh session counters and supported resistance-command encodings. Metadata changes and changed device names reset physical evidence; reconnect only the same physical trainer during one report, since device names are not unique identifiers. Follow the [device integration guide](./DEVICE_INTEGRATION_GUIDE.md) and [hardware validation policy](./HARDWARE_VALIDATION.md) before submitting evidence.
