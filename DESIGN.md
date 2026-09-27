# Open Trainer design system

The ride should feel calm, readable from the bike, and lightly alive. Charcoal surfaces keep the screen quiet; lime identifies the primary action, target power, and current effort. Warm amber identifies simulated data and helpful notices. Errors use a separate warm red treatment.

Desktop is the current design priority. Mobile-specific polish and phone trainer testing are deferred at the user's request; the existing responsive fallback remains available.

## Files and boundaries

- `apps/trainer-lab/src/ui/tokens.css` defines semantic colors, font families and sizes, spacing, radii, focus treatment, and motion. Adjust shared values here. Color names express roles rather than a particular palette.
- `apps/trainer-lab/src/ui/components.css` defines reusable native controls, metric groups, choice cards, notices, and status badges. Components use semantic HTML and existing browser focus, disabled, radio, and select behavior.
- `apps/trainer-lab/src/style.css` imports both layers and handles page composition, workout profile, power feedback, history/recovery, responsive layouts, and riding mode. The rebuilt diagnostic Lab has its own stylesheet and shares the token/component system.
- Focused TypeScript modules under `apps/trainer-lab/src/ui/` render workout choices, power feedback, and ride-history rows. Hardware and persistence remain behind the services boundary.

## Component contracts

| Component       | HTML contract                                                                                                                    | States                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Action          | A native `button.button` with `.primary`, `.subtle`, or `.stop-button`                                                           | Native `disabled`, `:focus-visible`, hover, press                                                                               |
| Compact control | A native `button.square-button` or `button.icon-button` with an accessible label                                                 | Native disabled and focus states; fixed size prevents shrinking                                                                 |
| Text action     | A native `button.text-button`                                                                                                    | Underlined text remains identifiable without color                                                                              |
| Metric          | `.metric-label`, a numeric `strong`, and `.unit` or `small`; place in `.power-metric`, `.target-metric`, or `.secondary-metrics` | Tabular numerals prevent distracting movement; target uses accent color                                                         |
| Workout choice  | `label.workout-option` contains a native radio, descriptive text, and decorative `.radio-mark`                                   | `:has(input:checked)`, focus-visible, and disabled derive from the real input                                                   |
| Form field      | A labeled native `select`, or `.watts-input` containing a number input and its unit                                              | Keep native constraints and validation; labels must reference input IDs                                                         |
| Notice          | `.notice`; add `.error-notice` for an error                                                                                      | Use `role="alert"` for actionable errors and native `hidden` when absent                                                        |
| Ride status     | `.state-pill` with text; add `.live` only during an active riding state                                                          | The live pulse stops when `.live` is removed; text remains the source of meaning                                                |
| Connection      | `.connection-dot`, optionally `.connected`, next to connection text                                                              | Dot is supplemental; always describe connection in text                                                                         |
| Simulator       | `.demo-badge` next to the connection controls                                                                                    | Explicit text identifies simulated data independently of color                                                                  |
| Power guidance  | `.ride-feedback` combines a text label, target range, gauge, trainer-speed readout, and decorative road                          | `data-band` is `waiting`, `below`, `pocket`, or `above`; stale/missing data hides the needle and never implies on-target effort |
| Recovery        | `.recovery-card` explains the saved workout/time and exposes reconnect/recovery or archive actions                               | Restored rides stay paused until explicit Resume; never imply automatic trainer control                                         |
| Ride history    | `.history-row` shows ride identity, metrics, and a CSV action                                                                    | Last 30 rides; label simulator and partial records; offer a separate JSON backup export                                         |

## Setup and saved data

Seven native workout choices expose Steady ride, Five efforts, Recovery spin, Tempo cruise, Rolling hills, Mountain climb, and Free ride. Their descriptions explain the effort pattern; hills and mountain are ERG power profiles, not route simulations. The steady-target field is optional: an empty field selects a conservative Auto suggestion, with a visible explanation that it is a starting point rather than a fitness test. The rider can override it or use target adjustment controls.

History and recovery describe browser-local storage plainly. The last 30 rides and unfinished checkpoint need no account, cloud, or cookies. Per-ride CSV and the JSON backup make the data accessible. Storage failures must replace the saved claim with actionable export guidance.

## Layout and motion

Setup uses a compact masthead and introduction so the connection controls and workout dashboard appear sooner. Desktop places workout selection beside the dashboard. Active riding hides setup and uses two columns for power and guidance at widths of at least 900 px, keeping interval progress and ride controls visible. The full set of ride controls was verified at 1366 × 768. The responsive fallback stacks panels on narrow screens; it is not a claim of phone Bluetooth support or completed mobile validation.

Hover and press feedback uses short tokenized transitions. The live badge breathes softly; only the current interval shimmers, and only while the ride status is live. Decorative road movement requires live riding and reported speed, and the rider accent animates when fresh power is on target. The gauge pairs blue/below, lime/on-target, and amber/above with explicit text; the on-target range is within 5 W or 5% of target, whichever is greater. None of the motion carries essential information. `prefers-reduced-motion: reduce` disables animation and transitions, including pseudo-elements.

Keep HTML state classes tied to actual application state. Keep numeric wattage readable, avoid flashing warnings, and never use motion to imply that a physical trainer is connected. The simulator badge remains explicit throughout a demo.

## Trainer Lab

The Lab shares the desktop visual language while exposing a denser diagnostic view: power/cadence/speed and additional reported fields, freshness, a recent telemetry chart, capabilities/ranges, separate connection/control/activity states, manual ERG/resistance/simulation controls, and packet/session history. Missing fields display a dash. Stale values are labeled as the last received packet, not presented as live. The 80 W test sequence is visibly simulator-only; snapshot and log exports support troubleshooting.
