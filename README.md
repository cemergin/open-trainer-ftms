# Open Trainer — phase 1

This repository contains the first, deliberately narrow slice of the project:

1. `@open-trainer/ftms`, a browser-oriented FTMS smart-trainer library.
2. Trainer Lab, a minimal interface for inspecting telemetry and testing safe control commands.

There is no account system, cloud service, multiplayer code, workout marketplace, or game framework in this phase.

## Requirements

- Node.js 20.19 or newer
- Chrome or Edge for a real trainer
- A secure context: HTTPS in production or `localhost` during development
- KICKR CORE firmware 1.1.1 or newer for standard Bluetooth FTMS

## Run the lab

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:4173`. Choose **Use simulator** to exercise the entire public API without hardware.

## Verify the workspace

```sh
npm test
npm run typecheck
npm run build
```

The library follows a test-first workflow. Its current suite covers FTMS packet codecs, reactive state behavior, GATT operation serialization, FTMS command sequencing, trainer state transitions, and package export boundaries.

## Manual npm release

The **Publish npm package** GitHub Action is manual and defaults to a dry run. It installs dependencies from the lockfile, runs the complete test/type/build suite, and verifies the package archive before any publish step can execute.

For a real release:

1. Bump `packages/ftms/package.json` and `package-lock.json` in a reviewed commit on `main`. npm versions cannot be overwritten.
2. In the npm package settings, configure a GitHub Actions trusted publisher for user `cemergin`, repository `open-trainer-ftms`, workflow file `publish.yml`, environment `npm`, and allow the `npm publish` action.
3. Optionally protect the repository's `npm` environment with required reviewers.
4. Open **Actions → Publish npm package → Run workflow**, select `publish`, choose the `next` or `latest` tag, and enter `publish @open-trainer/ftms` exactly.

The workflow uses short-lived OIDC authentication and publishes provenance from a GitHub-hosted runner. If an initial token-authenticated publish is required before npm will let you configure the trusted publisher, add a narrowly scoped automation token as the `NPM_TOKEN` secret on the `npm` environment, publish once, then remove the secret after trusted publishing is configured.

See npm's [trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) for the one-time registry configuration.

## First real-trainer session

1. Update the trainer in the Wahoo app, then fully close Wahoo, Zwift, and other trainer applications.
2. Put the bike on the trainer and plug the trainer into power.
3. Open Trainer Lab in Chrome or Edge and choose **Connect trainer**.
4. Confirm that power and cadence appear before taking control.
5. Choose **Take control**.
6. Set a low target such as 80 W, then choose **Start**.
7. Confirm that **Stop resistance** returns the trainer to a safe state.
8. Download the session log if anything behaves unexpectedly.

Do not perform the first control test on an unoccupied bike. ERG mode can increase resistance sharply when cadence falls.

## Package architecture

The trainer core depends on the small `FtmsTransport` port. The included adapters are:

- `WebBluetoothFtmsTransport` for physical BLE hardware.
- `MockFtmsTransport` for the lab, unit tests, and the future single-player game.

The future game should consume only the package's public telemetry and control API. It should not parse Bluetooth packets or access GATT characteristics directly.

```ts
import type { Trainer } from "@open-trainer/ftms";
import { createWebBluetoothTrainer } from "@open-trainer/ftms/web-bluetooth";
import { createMockTrainer } from "@open-trainer/ftms/testing";
```

Reactive data flows out through read-only state and streams. Async commands flow in through serialized queues. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the boundaries, TDD strategy, and remaining hardware-validation plan.

## Next phase

After hardware validation, the next contained milestone is a local-first single-player workout engine and one playable arena. The trainer library remains independent and publishable.
