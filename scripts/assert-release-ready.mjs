import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const defaultWorkspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validateCompatibility = ajv.compile(
  JSON.parse(
    readFileSync(join(defaultWorkspaceRoot, "hardware", "compatibility.schema.json"), "utf8"),
  ),
);
const validateReport = ajv.compile(
  JSON.parse(readFileSync(join(defaultWorkspaceRoot, "hardware", "report.schema.json"), "utf8")),
);
const requiredChecks = new Set([
  "connect-reconnect-10",
  "telemetry-power-cadence",
  "acquire-control",
  "erg-low-medium-high",
  "resistance-control",
  "simulation-grade",
  "pause-resume",
  "stop",
  "control-loss",
  "competing-app",
  "power-cycle",
  "stop-after-command-traffic",
]);

export function assertReleaseReady(workspaceRoot, distTag) {
  if (distTag !== "next" && distTag !== "latest") {
    throw new Error('Release channel must be either "next" or "latest".');
  }

  if (distTag === "next") {
    return "The next channel permits prerelease hardware evaluation.";
  }

  const compatibilityPath = join(workspaceRoot, "hardware", "compatibility.json");
  const compatibility = JSON.parse(readFileSync(compatibilityPath, "utf8"));
  if (!validateCompatibility(compatibility)) {
    throw new Error(
      `hardware/compatibility.json is invalid: ${ajv.errorsText(validateCompatibility.errors)}`,
    );
  }
  if (compatibility.validatedDevices.length === 0) {
    throw new Error(
      "The latest channel is blocked until at least one physical trainer passes the hardware acceptance suite.",
    );
  }

  const packageJson = JSON.parse(
    readFileSync(join(workspaceRoot, "packages", "ftms", "package.json"), "utf8"),
  );

  for (const device of compatibility.validatedDevices) {
    const relativeReport = normalize(device.report);
    const reportsRoot = join(workspaceRoot, "hardware", "reports") + sep;
    const reportPath = resolve(workspaceRoot, relativeReport);
    if (!reportPath.startsWith(reportsRoot) || !existsSync(reportPath)) {
      throw new Error(
        `Validated device report is missing or outside hardware/reports: ${device.report}`,
      );
    }

    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    if (!validateReport(report)) {
      throw new Error(
        `Hardware report is invalid (${device.report}): ${ajv.errorsText(validateReport.errors)}`,
      );
    }
    if (report.passed !== true) {
      throw new Error(`Hardware report did not pass: ${device.report}`);
    }
    if (report.packageVersion !== packageJson.version) {
      throw new Error(
        `Hardware report ${device.report} validates package ${report.packageVersion}, not ${packageJson.version}.`,
      );
    }
    if (
      report.hardware?.manufacturer !== device.manufacturer ||
      report.hardware?.model !== device.model ||
      report.hardware?.firmware !== device.firmware ||
      report.hardware?.resistanceControlFormat !== device.resistanceControlFormat
    ) {
      throw new Error(
        `Hardware report metadata does not match compatibility.json: ${device.report}`,
      );
    }
    const reportCheckIds = report.checks.map((check) => check.id);
    if (new Set(reportCheckIds).size !== reportCheckIds.length) {
      throw new Error(`Hardware report ${device.report} contains duplicate check IDs.`);
    }
    const passedChecks = new Set(
      report.checks.filter((check) => check?.passed === true).map((check) => check.id),
    );
    for (const check of requiredChecks) {
      if (!passedChecks.has(check)) {
        throw new Error(`Hardware report ${device.report} is missing passing check ${check}.`);
      }
    }
  }

  const major = Number.parseInt(packageJson.version.split(".")[0] ?? "0", 10);
  const manufacturers = new Set(
    compatibility.validatedDevices.map((device) => device.manufacturer.toLowerCase()),
  );
  if (major >= 1 && manufacturers.size < 2) {
    throw new Error(
      "A 1.0+ latest release requires passing reports from two trainer manufacturers.",
    );
  }

  return `Validated ${compatibility.validatedDevices.length} physical trainer configuration(s) for the latest channel.`;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    console.log(assertReleaseReady(defaultWorkspaceRoot, process.argv[2]));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
