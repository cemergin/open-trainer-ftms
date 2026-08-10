# Contributing to Open Trainer

Thank you for helping make open indoor training software safer and more useful.

## Development setup

Requirements:

- Node.js 20.19 or newer
- npm with lockfile v3 support
- Chrome or Edge only when testing physical Web Bluetooth hardware

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run verify:package
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

Remove device identifiers and personal workout data from Bluetooth captures before attaching them.

## Commit and release policy

Commits should be small enough to review and use an imperative summary. Changesets calculate package versions and maintain the changelog through a release pull request. Publishing remains a separate, manual GitHub Action with an npm environment gate.

Security vulnerabilities belong in GitHub private vulnerability reporting, not a public issue. See [SECURITY.md](./SECURITY.md).
