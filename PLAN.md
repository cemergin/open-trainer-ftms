# Open Trainer: desktop riding plan

## Outcome and scope

A free desktop app for the rider's Wahoo KICKR CORE and other ERG-capable Bluetooth FTMS trainers: connect, choose a workout, ride with clear power guidance, pause/end, and keep the activity data. The goal covers the core indoor workout flow; it does not claim full Zwift feature parity. Physical pairing and resistance response remain to be checked with the rider.

Desktop is the current priority. Mobile-specific polish and phone trainer testing are deferred at the user's request; the responsive fallback remains. GitHub Pages publication is in scope. Accounts, cloud storage, multiplayer, a 3D world, and a new frontend framework are outside this iteration.

## Implemented experience

- Seven workouts: Steady ride, Five efforts, Recovery spin, Tempo cruise, Rolling hills, Mountain climb, and Free ride. These are general warm-up/main/cool-down power profiles, not personalized training prescriptions. Hills and mountain use ERG power rather than simulated routes.
- Optional steady target. Auto provides a conservative preset and can lower it using a previous completed physical ride's average power. The rider can override or adjust it; Auto makes no measured-FTP claim.
- Large power, cadence, speed, and time readouts; a below/on/above-target gauge with text; interval profile, countdown, and next-step guidance. Live movement and on-target animation respect reduced motion.
- Explicit control acquisition, acknowledged targets, Pause/Resume and End ride. Late commands cannot restart an ended ride. Disconnect/control loss interrupts the session; stale data, sleep, and sustained low cadence trigger a pause.
- Last 30 rides, per-ride CSV, and a JSON backup export. Unfinished-ride checkpoints save every five seconds of recorded riding and on lifecycle/page-exit events. Recovery requires reconnecting and explicitly resuming; recorded time, workout, adjustment, samples, and measurements return paused.
- Browser local storage behind the service boundary. No cookies or cloud are used, and simulator data stays visibly distinguished from physical rides.
- Rebuilt Trainer Lab with shared UI tokens/components, richer telemetry and freshness indicators, power/cadence chart, capability/range inspection, manual controls, packet/command history, diagnostic exports, and an 80 W simulator-only test sequence.

## Implementation and validation status

1. Retained and hardened the independent FTMS library, including control ownership, transport cleanup, and queued-command behavior.
2. Completed parallel work on lifecycle/recovery, app storage/UI, and diagnostic controls. Large production changes receive independent review.
3. The latest local validation passed 106 tests: 85 app and 21 library. Type checking, production build, and package verification passed.
4. Desktop browser verification covered workout selection, start/adjust/pause/resume/end, feedback, history, and reload recovery. A fresh-page recovery stayed paused, then resumed with the recorded data preserved. All ride controls fit at 1366 × 768. Trainer Lab's 80 W simulator sequence, 95 W adjustment, and Stop completed with a clean console.
5. Final read-only Codeflow assessment against clean baseline `a0bcf55e7109703a4357d36504dc96faff98a73a` found no material cleanup candidates. Missing analyzer inputs are recorded privately as unavailable. GitHub Pages publication and hosted verification remain pending; see [GITHUB_PAGES.md](./GITHUB_PAGES.md).
6. The local app is available at `http://127.0.0.1:4173`. A physical KICKR CORE session remains the final compatibility/response check.

## Architecture and design contracts

Trainer adapters and browser capabilities enter through `src/services/index.ts`; persistence is re-exported by that boundary. Workout plans and the ride lifecycle remain separate from UI rendering. Semantic tokens and reusable native components live in `src/ui/`; see [ARCHITECTURE.md](./ARCHITECTURE.md) and [DESIGN.md](./DESIGN.md).

## Verification and Codeflow

- Test observable behavior and failure cases, especially pending-command End races, honest stop acknowledgements, explicit recovery, malformed storage, and stale feedback.
- Measure source change size and inspect introduced complexity/duplication with a fresh read-only assessor. Keep raw telemetry in a private local note.
- CRAP1 requires per-function complexity and basis-path coverage. Verbosity requires configured AST/clone outputs; erosion requires CC and callable SLOC. Mark absent inputs unavailable; do not invent scores or install analyzers solely to generate them.
- Run at most one narrowly scoped cleanup pass for actionable regressions, then rerun relevant verification. Earlier assessments do not substitute for the final pass over the expanded scope.
