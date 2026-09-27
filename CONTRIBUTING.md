# Contributing to Open Trainer

Thank you for helping make open indoor training software safer and more useful.

## Development setup

Requirements:

- Node.js 22.13+ (22.x), 24.x, or 26+ for workspace development
- npm 10.9 or newer
- Chrome or Edge only when testing physical Web Bluetooth hardware

Use `nvm use` for the recommended Node.js 24 toolchain. TypeScript 7 compiles the workspace through the explicit `@typescript/native` alias. The `typescript` alias supplies Microsoft’s TypeScript 6 compatibility API for typed ESLint; it does not replace the build compiler. The published FTMS library
still supports Node.js 20.19+; CI checks its installed runtime separately from the
development tools.

```sh
npm ci
npm run verify
```

Use `npm run dev` and the simulator for normal Trainer Lab development. Physical-trainer tests must begin at low resistance on an unoccupied bike, with another trainer application fully disconnected.

## Pull requests

Keep protocol parsing, trainer semantics, transports, and UI concerns in their existing boundaries. Add or update tests before changing observable library behavior. Avoid model-name conditionals when a capability check or compatibility profile can express the behavior.

For a user-visible `@open-trainer/ftms` change, run `npm run changeset` and commit the generated file. Documentation, tests, CI, and unpublished Trainer Lab work do not require a changeset.

Pull requests should explain:

- The behavior and motivation.
- How it was verified.
- Hardware model and firmware for device-specific observations.
- Safety implications for resistance or control behavior.
- Whether physical evidence is required or changed.

Remove device identifiers and personal workout data from Bluetooth captures before attaching them.

## Commit and release policy

Commits should be small enough to review and use an imperative summary. Changesets calculate package versions and maintain the changelog through a release pull request. Publishing remains a separate, manual GitHub Action with an npm environment gate.

Changes to physical compatibility evidence must follow the [device integration guide](./DEVICE_INTEGRATION_GUIDE.md) and [hardware validation policy](./HARDWARE_VALIDATION.md). The `latest` release channel rejects missing, stale, simulated, or incomplete evidence.

Security vulnerabilities belong in GitHub private vulnerability reporting, not a public issue. See [SECURITY.md](./SECURITY.md).
