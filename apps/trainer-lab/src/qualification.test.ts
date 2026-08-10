import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
  buildQualificationReport,
  createEmptyQualificationChecks,
  QUALIFICATION_CHECKS,
  qualificationBlockers,
  qualificationReportFilename,
  type QualificationReadinessInput,
} from "./qualification.js";

function completeInput(): QualificationReadinessInput {
  const checks = createEmptyQualificationChecks();
  for (const check of QUALIFICATION_CHECKS) {
    checks[check.id] = { passed: true, notes: `Observed ${check.id}` };
  }
  return {
    safetyAcknowledged: true,
    realTrainerConnected: true,
    metadata: {
      packageVersion: "0.2.0",
      sourceCommit: "0123456789abcdef0123456789abcdef01234567",
      runtimeFingerprint: "a".repeat(64),
      manufacturer: "Wahoo",
      model: "KICKR CORE",
      firmware: "1.5.36",
      resistanceControlFormat: "sint16",
      operatingSystem: "macOS 15",
      browser: "Chrome",
      browserVersion: "140.0.0",
      secureContext: true,
      notes: "Sanitized physical run.",
    },
    session: {
      source: "trainer-lab",
      startedAt: "2026-08-10T12:00:00Z",
      realConnectionCount: 10,
      telemetrySamples: 20,
      controlResponses: 12,
      errorCount: 0,
    },
    checks,
  };
}

describe("physical qualification reports", () => {
  it("builds a passing schema-shaped report only from complete physical evidence", () => {
    const input = completeInput();
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(
      JSON.parse(
        readFileSync(new URL("../../../hardware/report.schema.json", import.meta.url), "utf8"),
      ),
    );
    const report = buildQualificationReport(input);

    expect(qualificationBlockers(input)).toEqual([]);
    expect(report).toMatchObject({
      schemaVersion: 2,
      packageVersion: "0.2.0",
      sourceCommit: "0123456789abcdef0123456789abcdef01234567",
      runtimeFingerprint: "a".repeat(64),
      hardware: { manufacturer: "Wahoo", model: "KICKR CORE" },
      client: { secureContext: true },
      testSession: { realConnectionCount: 10 },
      passed: true,
    });
    expect(validate(report), ajv.errorsText(validate.errors)).toBe(true);
  });

  it("blocks simulator-only, incomplete, and undocumented runs", () => {
    const input = completeInput();
    input.realTrainerConnected = false;
    input.session.realConnectionCount = 1;
    input.session.telemetrySamples = 0;
    input.checks.stop.notes = "";

    expect(qualificationBlockers(input)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/physical trainer/),
        expect.stringMatching(/9 more real connection/),
        expect.stringMatching(/telemetry/),
        expect.stringMatching(/observation notes.*safety stop/i),
      ]),
    );
    expect(buildQualificationReport(input)).toMatchObject({ passed: false });
  });

  it("creates a sanitized compatibility-report filename", () => {
    expect(qualificationReportFilename(completeInput().metadata)).toBe(
      "wahoo-kickr-core-1-5-36.json",
    );
  });
});
