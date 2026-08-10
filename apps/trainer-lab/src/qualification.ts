export const QUALIFICATION_CHECKS = [
  {
    id: "connect-reconnect-10",
    title: "Connect and reconnect ten times",
    procedure:
      "Connect, wait for ready, disconnect, and repeat without reloading this page. Watch for stale state or duplicate events.",
    passingObservation: "All ten attempts reach ready and then disconnected cleanly.",
    notePrompt: "Record the attempt count and any chooser, timing, or reconnect behavior.",
  },
  {
    id: "telemetry-power-cadence",
    title: "Verify live power and cadence",
    procedure:
      "Pedal gently, confirm power and cadence update, then coast and confirm both values return toward zero.",
    passingObservation:
      "Values are plausible, responsive, and do not remain falsely active after coasting.",
    notePrompt: "Record an observed watt/cadence pair and the coast-down behavior.",
  },
  {
    id: "acquire-control",
    title: "Acquire exclusive FTMS control",
    procedure:
      "Close other trainer apps, choose Take control, and confirm the control state becomes owned.",
    passingObservation: "The request succeeds once and control state becomes owned.",
    notePrompt: "Record the control result and whether any other app had to be closed.",
  },
  {
    id: "erg-low-medium-high",
    title: "Exercise three safe ERG targets",
    procedure:
      "After an unoccupied low-target check, ride at low, medium, and high-but-comfortable targets long enough to settle.",
    passingObservation:
      "Observed power settles reasonably near every requested target without unsafe surges.",
    notePrompt:
      "Record requested watts, steady watts, cadence, and approximate settling time for all three.",
  },
  {
    id: "resistance-control",
    title: "Exercise manual resistance",
    procedure:
      "Test the advertised minimum, midpoint, and a safe upper level. Do not use the absolute maximum if it is unsafe.",
    passingObservation:
      "Resistance changes in the expected direction and every command receives a success response.",
    notePrompt: "Record the three requested levels and what changed physically.",
  },
  {
    id: "simulation-grade",
    title: "Exercise simulated grade",
    procedure: "Test a small descent, flat road, and small climb, such as -2%, 0%, and +2%.",
    passingObservation:
      "Resistance decreases, returns to baseline, and increases in the expected order.",
    notePrompt: "Record the three grades and the observed response.",
  },
  {
    id: "pause-resume",
    title: "Run the activity lifecycle",
    procedure: "Start, pause, resume, and reset while observing activity and control state.",
    passingObservation:
      "States match each action and reset returns control to unavailable and activity to idle.",
    notePrompt: "Record the state sequence shown by Trainer Lab.",
  },
  {
    id: "stop",
    title: "Verify the primary safety stop",
    procedure: "While running at a low target, choose Stop resistance and stop pedaling.",
    passingObservation:
      "Activity reaches idle promptly and physical resistance releases predictably.",
    notePrompt: "Record the target before stop, state sequence, and physical response.",
  },
  {
    id: "control-loss",
    title: "Verify control-loss state",
    procedure:
      "Let a competing application request control while Trainer Lab is connected and observe Machine Status behavior.",
    passingObservation:
      "Control becomes revoked and activity becomes idle, or the exact device deviation is documented.",
    notePrompt: "Record the competing app and the resulting control/activity states.",
  },
  {
    id: "competing-app",
    title: "Verify competing-app isolation",
    procedure:
      "Repeat acquisition with the vendor app or another training app open, then closed. Never allow two apps to command resistance unnoticed.",
    passingObservation:
      "Contention is visible as a rejection, revocation, or disconnect; it is never silent.",
    notePrompt: "Record both apps and the exact contention behavior.",
  },
  {
    id: "power-cycle",
    title: "Recover from trainer power loss",
    procedure:
      "At a low target, stop, unplug the trainer, wait 30 seconds, reconnect, and connect again.",
    passingObservation:
      "Live state clears on loss and the next connection performs fresh discovery successfully.",
    notePrompt: "Record disconnect detection, cleared state, and reconnect outcome.",
  },
  {
    id: "stop-after-command-traffic",
    title: "Prove stop wins over queued targets",
    procedure:
      "At low intensity, submit several target changes quickly and immediately choose Stop resistance.",
    passingObservation:
      "No later target takes effect after stop; the final activity state is idle.",
    notePrompt: "Record the target sequence, stop timing, final state, and physical response.",
  },
] as const;

export type QualificationCheckId = (typeof QUALIFICATION_CHECKS)[number]["id"];

export interface QualificationCheckState {
  passed: boolean;
  notes: string;
}

export type QualificationChecksState = Record<QualificationCheckId, QualificationCheckState>;

export interface QualificationMetadata {
  packageVersion: string;
  sourceCommit: string;
  runtimeFingerprint: string;
  manufacturer: string;
  model: string;
  firmware: string;
  resistanceControlFormat: "sint16" | "uint8";
  operatingSystem: string;
  browser: string;
  browserVersion: string;
  secureContext: boolean;
  notes: string;
}

export interface QualificationSession {
  source: "trainer-lab";
  startedAt: string;
  realConnectionCount: number;
  telemetrySamples: number;
  controlResponses: number;
  errorCount: number;
}

export interface QualificationReadinessInput {
  safetyAcknowledged: boolean;
  realTrainerConnected: boolean;
  metadata: QualificationMetadata;
  session: QualificationSession;
  checks: QualificationChecksState;
}

export function createEmptyQualificationChecks(): QualificationChecksState {
  return Object.fromEntries(
    QUALIFICATION_CHECKS.map(({ id }) => [id, { passed: false, notes: "" }]),
  ) as QualificationChecksState;
}

export function qualificationBlockers(input: QualificationReadinessInput): string[] {
  const blockers: string[] = [];
  if (!input.safetyAcknowledged) blockers.push("Acknowledge the physical safety setup.");
  if (!input.realTrainerConnected) {
    blockers.push("Connect a physical trainer successfully during this page session.");
  }
  if (!input.metadata.secureContext) blockers.push("Use HTTPS or localhost.");
  for (const [label, value] of [
    ["manufacturer", input.metadata.manufacturer],
    ["model", input.metadata.model],
    ["firmware", input.metadata.firmware],
    ["operating system", input.metadata.operatingSystem],
    ["browser", input.metadata.browser],
    ["browser version", input.metadata.browserVersion],
  ] as const) {
    if (!value.trim()) blockers.push(`Enter the ${label}.`);
  }
  if (input.session.realConnectionCount < 10) {
    blockers.push(`Complete ${10 - input.session.realConnectionCount} more real connection(s).`);
  }
  if (input.session.telemetrySamples < 1) blockers.push("Observe at least one telemetry sample.");
  if (input.session.controlResponses < 1) blockers.push("Receive at least one control response.");
  for (const check of QUALIFICATION_CHECKS) {
    const state = input.checks[check.id];
    if (!state.passed) blockers.push(`Pass: ${check.title}.`);
    if (!state.notes.trim()) blockers.push(`Add observation notes: ${check.title}.`);
  }
  return blockers;
}

export function buildQualificationReport(input: QualificationReadinessInput): object {
  return {
    $schema: "../report.schema.json",
    schemaVersion: 2,
    recordedAt: new Date().toISOString(),
    packageVersion: input.metadata.packageVersion,
    sourceCommit: input.metadata.sourceCommit,
    runtimeFingerprint: input.metadata.runtimeFingerprint,
    hardware: {
      manufacturer: input.metadata.manufacturer.trim(),
      model: input.metadata.model.trim(),
      firmware: input.metadata.firmware.trim(),
      resistanceControlFormat: input.metadata.resistanceControlFormat,
    },
    client: {
      operatingSystem: input.metadata.operatingSystem.trim(),
      browser: input.metadata.browser.trim(),
      browserVersion: input.metadata.browserVersion.trim(),
      secureContext: input.metadata.secureContext,
    },
    testSession: input.session,
    checks: QUALIFICATION_CHECKS.map(({ id }) => ({
      id,
      passed: input.checks[id].passed,
      notes: input.checks[id].notes.trim(),
    })),
    passed: qualificationBlockers(input).length === 0,
    notes: input.metadata.notes.trim(),
  };
}

export function qualificationReportFilename(metadata: QualificationMetadata): string {
  const component = (value: string): string =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "unknown";
  return `${component(metadata.manufacturer)}-${component(metadata.model)}-${component(metadata.firmware)}.json`;
}
