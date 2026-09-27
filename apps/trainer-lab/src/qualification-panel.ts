import {
  downloadText,
  loadQualificationDraft,
  saveQualificationDraft,
  qualificationClient,
} from "./services/index.js";
import {
  buildQualificationReport,
  QualificationTracker,
  QUALIFICATION_CHECKS,
  qualificationBlockers,
  qualificationReportFilename,
  type QualificationMetadata,
} from "./qualification.js";

interface ElementConstructor<T extends HTMLElement> {
  new (): T;
  readonly name: string;
}
function byId<T extends HTMLElement>(id: string, constructor: ElementConstructor<T>): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) throw new Error(`Missing or invalid #${id}`);
  return element;
}

interface QualificationPanel {
  readonly resistanceControlFormat: QualificationMetadata["resistanceControlFormat"];
  connected(real: boolean, deviceName: string | undefined): void;
  telemetry(real: boolean): void;
  response(real: boolean): void;
  error(real: boolean): void;
}

export function createQualificationPanel(
  log: (message: string, kind?: "info" | "error") => void,
): QualificationPanel {
  const ui = {
    resistanceFormat: byId("resistance-format", HTMLSelectElement),
    qualificationStorage: byId("qualification-storage", HTMLElement),
    qualificationProgress: byId("qualification-progress", HTMLOutputElement),
    qualificationSafety: byId("qualification-safety", HTMLInputElement),
    qualificationManufacturer: byId("qualification-manufacturer", HTMLInputElement),
    qualificationModel: byId("qualification-model", HTMLInputElement),
    qualificationFirmware: byId("qualification-firmware", HTMLInputElement),
    qualificationOs: byId("qualification-os", HTMLInputElement),
    qualificationBrowser: byId("qualification-browser", HTMLInputElement),
    qualificationBrowserVersion: byId("qualification-browser-version", HTMLInputElement),
    qualificationPackageVersion: byId("qualification-package-version", HTMLElement),
    qualificationSecureContext: byId("qualification-secure-context", HTMLElement),
    qualificationConnections: byId("qualification-connections", HTMLElement),
    qualificationTelemetry: byId("qualification-telemetry", HTMLElement),
    qualificationResponses: byId("qualification-responses", HTMLElement),
    qualificationErrors: byId("qualification-errors", HTMLElement),
    qualificationChecks: byId("qualification-checks", HTMLOListElement),
    qualificationNotes: byId("qualification-notes", HTMLTextAreaElement),
    qualificationReadinessTitle: byId("qualification-readiness-title", HTMLElement),
    qualificationBlockers: byId("qualification-blockers", HTMLUListElement),
    qualificationReset: byId("qualification-reset", HTMLButtonElement),
    qualificationExport: byId("qualification-export", HTMLButtonElement),
  };
  const client = qualificationClient();
  const qualificationMetadata: QualificationMetadata = {
    packageVersion: __FTMS_PACKAGE_VERSION__,
    sourceCommit: __SOURCE_COMMIT__,
    runtimeFingerprint: __RUNTIME_FINGERPRINT__,
    manufacturer: "",
    model: "",
    firmware: "",
    resistanceControlFormat: "sint16",
    operatingSystem: client.operatingSystem,
    browser: client.browser,
    browserVersion: client.browserVersion,
    secureContext: client.secureContext,
    notes: "",
  };
  const tracker = new QualificationTracker(qualificationMetadata);
  const qualificationChecks = tracker.input.checks;
  const qualificationSession = tracker.input.session;
  const draft = loadQualificationDraft(qualificationMetadata.runtimeFingerprint);
  Object.assign(qualificationMetadata, draft.metadata);
  ui.qualificationStorage.hidden = draft.available;
  for (const check of QUALIFICATION_CHECKS) {
    qualificationChecks[check.id].notes = draft.notes[check.id] ?? "";
  }
  function persistQualification(): void {
    const saved = saveQualificationDraft(qualificationMetadata, qualificationChecks);
    ui.qualificationStorage.hidden = saved;
  }

  function syncQualificationInputs(): void {
    ui.qualificationSafety.checked = tracker.input.safetyAcknowledged;
    ui.resistanceFormat.value = qualificationMetadata.resistanceControlFormat;
    ui.qualificationManufacturer.value = qualificationMetadata.manufacturer;
    ui.qualificationModel.value = qualificationMetadata.model;
    ui.qualificationFirmware.value = qualificationMetadata.firmware;
    ui.qualificationOs.value = qualificationMetadata.operatingSystem;
    ui.qualificationBrowser.value = qualificationMetadata.browser;
    ui.qualificationBrowserVersion.value = qualificationMetadata.browserVersion;
    ui.qualificationNotes.value = qualificationMetadata.notes;
    ui.qualificationPackageVersion.textContent = qualificationMetadata.packageVersion;
    ui.qualificationSecureContext.textContent = qualificationMetadata.secureContext ? "yes" : "no";
    ui.qualificationSecureContext.className = qualificationMetadata.secureContext ? "pass" : "fail";
  }

  function renderQualificationChecks(): void {
    ui.qualificationChecks.replaceChildren();
    QUALIFICATION_CHECKS.forEach((check, index) => {
      const item = document.createElement("li");
      item.className = "qualification-check";

      const body = document.createElement("div");
      const heading = document.createElement("h3");
      heading.textContent = `${index + 1}. ${check.title}`;
      const procedure = document.createElement("p");
      procedure.textContent = check.procedure;
      const expected = document.createElement("p");
      expected.className = "qualification-expected";
      expected.textContent = `Pass when: ${check.passingObservation}`;
      body.append(heading, procedure, expected);

      const evidence = document.createElement("div");
      evidence.className = "qualification-evidence";
      const passLabel = document.createElement("label");
      passLabel.className = "qualification-pass";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = qualificationChecks[check.id].passed;
      checkbox.disabled = !tracker.input.safetyAcknowledged;
      checkbox.dataset.qualificationCheck = check.id;
      const passText = document.createElement("span");
      passText.textContent = "Observed pass";
      passLabel.append(checkbox, passText);

      const notesLabel = document.createElement("label");
      notesLabel.textContent = "Observation notes";
      const notes = document.createElement("textarea");
      notes.rows = 3;
      notes.value = qualificationChecks[check.id].notes;
      notes.placeholder = check.notePrompt;
      notes.dataset.qualificationNotes = check.id;
      notesLabel.append(notes);
      evidence.append(passLabel, notesLabel);
      item.append(body, evidence);
      ui.qualificationChecks.append(item);

      checkbox.addEventListener("change", () => {
        qualificationChecks[check.id].passed = checkbox.checked;
        persistQualification();
        renderQualificationStatus();
      });
      notes.addEventListener("input", () => {
        qualificationChecks[check.id].notes = notes.value;
        persistQualification();
        renderQualificationStatus();
      });
    });
  }

  function renderQualificationStatus(): void {
    const passed = QUALIFICATION_CHECKS.filter(({ id }) => qualificationChecks[id].passed).length;
    const blockers = qualificationBlockers(tracker.input);
    ui.qualificationProgress.textContent = `${passed} / ${QUALIFICATION_CHECKS.length} passed`;
    ui.qualificationProgress.className = `progress-badge ${blockers.length === 0 ? "complete" : ""}`;
    ui.qualificationConnections.textContent = `${qualificationSession.realConnectionCount} / 10`;
    ui.qualificationTelemetry.textContent = String(qualificationSession.telemetrySamples);
    ui.qualificationResponses.textContent = String(qualificationSession.controlResponses);
    ui.qualificationErrors.textContent = String(qualificationSession.errorCount);
    ui.qualificationExport.disabled = blockers.length > 0;
    ui.qualificationReadinessTitle.textContent =
      blockers.length === 0 ? "Passing report is ready" : "Report is not ready";
    ui.qualificationBlockers.replaceChildren();
    const visibleBlockers = blockers.slice(0, 6);
    for (const blocker of visibleBlockers) {
      const item = document.createElement("li");
      item.textContent = blocker;
      ui.qualificationBlockers.append(item);
    }
    if (blockers.length > visibleBlockers.length) {
      const item = document.createElement("li");
      item.textContent = `${blockers.length - visibleBlockers.length} more requirement(s) remain.`;
      ui.qualificationBlockers.append(item);
    }
  }

  function resetQualification(): void {
    tracker.input.safetyAcknowledged = false;
    tracker.reset();
    qualificationMetadata.manufacturer = "";
    qualificationMetadata.model = "";
    qualificationMetadata.firmware = "";
    qualificationMetadata.notes = "";
    for (const check of QUALIFICATION_CHECKS) {
      qualificationChecks[check.id] = { passed: false, notes: "" };
    }
    persistQualification();
    syncQualificationInputs();
    renderQualificationChecks();
    renderQualificationStatus();
    log("Physical qualification checklist cleared.");
  }

  ui.resistanceFormat.addEventListener("change", () => {
    qualificationMetadata.resistanceControlFormat =
      ui.resistanceFormat.value === "uint8" ? "uint8" : "sint16";
    tracker.reset();
    persistQualification();
    renderQualificationChecks();
    renderQualificationStatus();
  });

  ui.qualificationSafety.addEventListener("change", () => {
    tracker.input.safetyAcknowledged = ui.qualificationSafety.checked;
    persistQualification();
    renderQualificationChecks();
    renderQualificationStatus();
  });

  for (const [input, key] of [
    [ui.qualificationManufacturer, "manufacturer"],
    [ui.qualificationModel, "model"],
    [ui.qualificationFirmware, "firmware"],
    [ui.qualificationOs, "operatingSystem"],
    [ui.qualificationBrowser, "browser"],
    [ui.qualificationBrowserVersion, "browserVersion"],
    [ui.qualificationNotes, "notes"],
  ] as const) {
    input.addEventListener("input", () => {
      if (key !== "notes" && qualificationMetadata[key] !== input.value) {
        tracker.reset();
        renderQualificationChecks();
      }
      qualificationMetadata[key] = input.value;
      persistQualification();
      renderQualificationStatus();
    });
  }

  ui.qualificationReset.addEventListener("click", () => {
    resetQualification();
  });

  ui.qualificationExport.addEventListener("click", () => {
    const input = tracker.input;
    const blockers = qualificationBlockers(input);
    if (blockers.length > 0) {
      log(`Qualification report is blocked: ${blockers[0]}`, "error");
      return;
    }
    const report = buildQualificationReport(input);
    downloadText(
      JSON.stringify(report, null, 2),
      qualificationReportFilename(qualificationMetadata),
      "application/json",
    );
    log("Exported a passing, sanitized physical qualification report.");
  });

  syncQualificationInputs();
  renderQualificationChecks();
  renderQualificationStatus();
  return {
    get resistanceControlFormat() {
      return qualificationMetadata.resistanceControlFormat;
    },
    connected(real: boolean, deviceName: string | undefined): void {
      tracker.connected(real, deviceName);
      renderQualificationChecks();
      renderQualificationStatus();
    },
    telemetry(real: boolean): void {
      if (real) qualificationSession.telemetrySamples += 1;
      renderQualificationStatus();
    },
    response(real: boolean): void {
      if (real) qualificationSession.controlResponses += 1;
      renderQualificationStatus();
    },
    error(real: boolean): void {
      if (real) qualificationSession.errorCount += 1;
      renderQualificationStatus();
    },
  };
}
