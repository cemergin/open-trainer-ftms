import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertReleaseReady } from "./assert-release-ready.mjs";

const checkIds = [
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
];

function fixture(version = "0.2.0") {
  const root = mkdtempSync(join(tmpdir(), "open-trainer-release-gate-"));
  mkdirSync(join(root, "hardware", "reports"), { recursive: true });
  mkdirSync(join(root, "packages", "ftms"), { recursive: true });
  writeFileSync(join(root, "packages", "ftms", "package.json"), JSON.stringify({ version }));
  return root;
}

function addDevice(root, manufacturer = "Wahoo") {
  const { version } = JSON.parse(
    readFileSync(join(root, "packages", "ftms", "package.json"), "utf8"),
  );
  const device = {
    manufacturer,
    model: "KICKR CORE",
    firmware: "1.2.3",
    resistanceControlFormat: "sint16",
    report: `hardware/reports/${manufacturer.toLowerCase()}.json`,
  };
  const report = {
    schemaVersion: 1,
    recordedAt: "2026-08-10T12:00:00Z",
    packageVersion: version,
    passed: true,
    hardware: {
      manufacturer: device.manufacturer,
      model: device.model,
      firmware: device.firmware,
      resistanceControlFormat: device.resistanceControlFormat,
    },
    client: {
      operatingSystem: "Test OS 1.0",
      browser: "Chrome",
      browserVersion: "140.0.0",
    },
    checks: checkIds.map((id) => ({ id, passed: true })),
  };
  writeFileSync(join(root, device.report), JSON.stringify(report));
  return device;
}

test("next does not require physical evidence", () => {
  assert.match(assertReleaseReady("/not/read", "next"), /prerelease/);
});

test("latest rejects an empty compatibility matrix", (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "hardware", "compatibility.json"),
    JSON.stringify({ schemaVersion: 1, validatedDevices: [] }),
  );

  assert.throws(() => assertReleaseReady(root, "latest"), /at least one physical trainer/);
});

test("pre-1.0 latest accepts one complete physical report", (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const device = addDevice(root);
  writeFileSync(
    join(root, "hardware", "compatibility.json"),
    JSON.stringify({ schemaVersion: 1, validatedDevices: [device] }),
  );

  assert.match(assertReleaseReady(root, "latest"), /Validated 1/);
});

test("latest rejects incomplete evidence and 1.0 with one manufacturer", (context) => {
  const root = fixture("1.0.0");
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const device = addDevice(root);
  writeFileSync(
    join(root, "hardware", "compatibility.json"),
    JSON.stringify({ schemaVersion: 1, validatedDevices: [device] }),
  );

  assert.throws(() => assertReleaseReady(root, "latest"), /two trainer manufacturers/);
  const reportPath = join(root, device.report);
  const incomplete = JSON.parse(readFileSync(reportPath, "utf8"));
  incomplete.checks.push({ ...incomplete.checks[0] });
  writeFileSync(reportPath, JSON.stringify(incomplete));
  assert.throws(() => assertReleaseReady(root, "latest"), /duplicate check IDs/);
  incomplete.checks.pop();
  incomplete.checks.pop();
  writeFileSync(reportPath, JSON.stringify(incomplete));
  assert.throws(() => assertReleaseReady(root, "latest"), /missing passing check/);
});
