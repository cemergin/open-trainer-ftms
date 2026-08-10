# Physical trainer acceptance gate

Automated tests cannot prove how a flywheel and brake behave. Publishing to npm's `latest` channel is therefore blocked until at least one real trainer passes this procedure and its sanitized evidence is committed. A 1.0 or later release requires two manufacturers.

Use `next` for prerelease software evaluation. Passing the simulator suite is necessary but never counts as physical validation.

## Safety setup

- Update the trainer firmware, unplug it for 30 seconds, and close every other trainer application.
- Secure the bicycle and keep the first control run unoccupied.
- Start with the smallest useful target. Keep the trainer's power switch accessible.
- Stop immediately for unexpected braking, smells, noise, heat, or unstable mounting.
- Never include serial numbers, Bluetooth addresses, account data, or personal workout data in evidence.

## Acceptance run

Follow the complete [physical trainer integration guide](./DEVICE_INTEGRATION_GUIDE.md). Trainer Lab presents the same 12 checks, retains draft notes locally, counts evidence from the current physical session, and exports a schema-shaped report only after every release requirement passes.

The JSON template remains available for tooling and review, but contributors should normally export from Trainer Lab. Record exact package, source fingerprint, firmware, browser, browser version, and operating-system versions. Every check below must pass:

1. Connect and disconnect ten times without duplicate subscriptions, stuck UI state, or a browser reload.
2. Confirm power and cadence update while pedaling and return toward zero after stopping.
3. Acquire control and confirm a competing application cannot silently retain it.
4. Exercise low, medium, and high-but-safe ERG targets; record requested and observed steady-state watts.
5. Exercise manual resistance at the advertised minimum, middle, and safe upper value.
6. Exercise negative, zero, and positive simulated grades within a safe range.
7. Start, pause, resume, stop, and reset; confirm state and physical resistance after each transition.
8. Force control loss with a competing app and confirm `control` becomes `revoked` and activity becomes `idle`.
9. Power-cycle the trainer during a session and confirm stale telemetry and capabilities are cleared.
10. Repeat stop after command traffic and confirm it is never overtaken by a later target.

Every check requires a useful sanitized observation. The release gate also requires ten real connections, at least one telemetry sample and control response, a secure browser context, and a runtime fingerprint matching the current behavioral sources. Add the report to `hardware/compatibility.json`, then run:

```sh
npm run release:check
```

The evidence file is a release artifact. Corrections should be reviewed like code; never edit a failed observation into a pass without rerunning it.
