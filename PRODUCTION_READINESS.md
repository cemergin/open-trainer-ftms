# Production readiness

The repository separates software readiness from physical-hardware qualification.

## Enforced software gates

- Strict TypeScript and type-aware ESLint.
- Prettier formatting with a zero-diff check.
- 95% statement, line, and function coverage; 80% branch coverage.
- Node 20 and 22 verification plus Node 24 package verification.
- Clean `npm ci`, complete dependency-graph audit, package build, consumer compilation, `publint`, Are the Types Wrong, clean tarball installation, and runtime import smoke tests.
- Pull requests that change the publishable package must include a Changeset; dependency installation in automation disables lifecycle scripts.
- Immutable commit SHAs for GitHub Actions, dependency review, code scanning, private vulnerability reporting, and Dependabot.
- Changesets-managed versions and a manual OIDC/provenance publish workflow.

Run the same pipeline locally with `npm run verify`.

## Enforced hardware gate

`npm run release:check` fails until committed physical evidence satisfies [HARDWARE_VALIDATION.md](./HARDWARE_VALIDATION.md). The manual workflow applies this check to `latest`; `next` remains the explicitly experimental channel.

At the moment, `hardware/compatibility.json` contains no passing physical device. That means the software pipeline can be green while a production-channel release remains correctly blocked. The first intended qualification target is a Wahoo KICKR CORE on recorded firmware and browser versions.

## Registry owner setup

The maintainer must still create or own the `@open-trainer` npm scope and configure npm trusted publishing for this repository's `publish.yml` workflow and `npm` environment. This is an external registry control and cannot be proven by repository code.
