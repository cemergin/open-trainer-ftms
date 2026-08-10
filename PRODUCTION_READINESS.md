# Production readiness

The repository separates software readiness from physical-hardware qualification.

## Enforced software gates

- Strict TypeScript and type-aware ESLint.
- Prettier formatting with a zero-diff check.
- 95% statement, line, and function coverage; 80% branch coverage.
- Node 20 and 22 verification plus Node 24 package verification.
- Clean `npm ci`, complete dependency-graph audit, package build, consumer compilation, `publint`, Are the Types Wrong, clean tarball installation, and runtime import smoke tests.
- Pull requests that change the publishable package must include a Changeset; dependency installation in automation disables lifecycle scripts.
- Immutable commit SHAs for GitHub Actions, dependency review, and Dependabot configuration.
- Changesets-managed versions and a manual OIDC/provenance publish workflow.

Run the same pipeline locally with `npm run verify`.

## Repository controls

Before calling the hosted project operationally production-ready, verify these GitHub settings from an authenticated owner session:

- Protect `main`; require the CI matrix, quality, packed-package, and dependency-review checks; require conversation resolution; block force pushes and deletion.
- Enable code scanning default setup, Dependabot security updates, secret scanning, push protection, non-provider patterns, and validity checks.
- Restrict the `npm` environment to protected branches and require a maintainer approval for deployment.

Repository files cannot activate or prove these owner-level settings. They are a separate deployment gate, not an implied property of a green local build.

## Enforced hardware gate

`npm run release:check` fails until committed physical evidence satisfies [HARDWARE_VALIDATION.md](./HARDWARE_VALIDATION.md). The manual workflow applies this check to `latest`; `next` remains the explicitly experimental channel. Each report carries a deterministic SHA-256 fingerprint of the library and Trainer Lab runtime sources, so a behavior change invalidates old hardware evidence while test-only or declaration-only changes do not.

At the moment, `hardware/compatibility.json` contains no passing physical device. That means the software pipeline can be green while a production-channel release remains correctly blocked. The first intended qualification target is a Wahoo KICKR CORE on recorded firmware and browser versions. Follow the vendor-neutral [device integration guide](./DEVICE_INTEGRATION_GUIDE.md); Trainer Lab records the non-persistent live-session counters and exports the schema-validated evidence.

## Registry owner setup

The maintainer must still create or own the `@open-trainer` npm scope and configure npm trusted publishing for this repository's `publish.yml` workflow and `npm` environment. This is an external registry control and cannot be proven by repository code.
