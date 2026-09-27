import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertReleaseReady } from "./assert-release-ready.mjs";
import { computeRuntimeFingerprint } from "./source-fingerprint.mjs";

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
  mkdirSync(join(root, "packages", "ftms", "src"), { recursive: true });
  mkdirSync(join(root, "apps", "trainer-lab", "src"), { recursive: true });
  writeFileSync(
    join(root, "packages", "ftms", "package.json"),
    JSON.stringify({ name: "@open-trainer/ftms", version }),
  );
  writeFileSync(
    join(root, "apps", "trainer-lab", "package.json"),
    JSON.stringify({
      name: "@open-trainer/trainer-lab",
      version,
      dependencies: { "@open-trainer/ftms": version },
    }),
  );
  writeFileSync(
    join(root, "tsconfig.base.json"),
    JSON.stringify({ compilerOptions: { target: "ES2022" } }),
  );
  writeFileSync(
    join(root, "packages", "ftms", "tsconfig.json"),
    JSON.stringify({ extends: "../../tsconfig.base.json" }),
  );
  writeFileSync(join(root, "apps", "trainer-lab", "vite.config.ts"), "export default {};\n");
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      version,
      packages: {
        "": { version },
        "packages/ftms": { version },
        "node_modules/@open-trainer/ftms": { link: true, resolved: "packages/ftms" },
        "node_modules/@typescript/native": { version: "7.0.2", integrity: "sha512-example" },
      },
    }),
  );
  writeFileSync(join(root, "packages", "ftms", "src", "index.ts"), "export {};\n");
  writeFileSync(join(root, "apps", "trainer-lab", "src", "main.ts"), "export {};\n");
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
    schemaVersion: 2,
    recordedAt: "2026-08-10T12:00:00Z",
    packageVersion: version,
    sourceCommit: "0123456789abcdef0123456789abcdef01234567",
    runtimeFingerprint: computeRuntimeFingerprint(root),
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
      secureContext: true,
    },
    testSession: {
      source: "trainer-lab",
      startedAt: "2026-08-10T11:00:00Z",
      realConnectionCount: 10,
      telemetrySamples: 20,
      controlResponses: 12,
      errorCount: 0,
    },
    checks: checkIds.map((id) => ({ id, passed: true, notes: `Observed ${id}` })),
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
  const finalCheck = incomplete.checks.at(-1);
  incomplete.checks[incomplete.checks.length - 1] = { ...incomplete.checks[0] };
  writeFileSync(reportPath, JSON.stringify(incomplete));
  assert.throws(() => assertReleaseReady(root, "latest"), /duplicate check IDs/);
  incomplete.checks[incomplete.checks.length - 1] = finalCheck;
  incomplete.checks[0].notes = "";
  writeFileSync(reportPath, JSON.stringify(incomplete));
  assert.throws(() => assertReleaseReady(root, "latest"), /missing observation notes/);
  incomplete.checks[0].notes = "Observed connect-reconnect-10";
  incomplete.checks[incomplete.checks.length - 1].passed = false;
  writeFileSync(reportPath, JSON.stringify(incomplete));
  assert.throws(() => assertReleaseReady(root, "latest"), /missing passing check/);
});

test("latest rejects evidence after behavioral source changes", (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const device = addDevice(root);
  writeFileSync(
    join(root, "hardware", "compatibility.json"),
    JSON.stringify({ schemaVersion: 1, validatedDevices: [device] }),
  );
  writeFileSync(
    join(root, "apps", "trainer-lab", "src", "qualification.test.ts"),
    "test('documentation-only test change', () => {});\n",
  );
  assert.match(assertReleaseReady(root, "latest"), /Validated 1/);
  writeFileSync(join(root, "packages", "ftms", "src", "index.ts"), "export {};\r\n");
  assert.match(assertReleaseReady(root, "latest"), /Validated 1/);
  writeFileSync(
    join(root, "packages", "ftms", "src", "index.ts"),
    "export const changed = true;\n",
  );

  assert.throws(() => assertReleaseReady(root, "latest"), /different library.*runtime/);
});

test("hardware evidence survives a version-only release", (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const device = addDevice(root);
  writeFileSync(
    join(root, "hardware", "compatibility.json"),
    JSON.stringify({ schemaVersion: 1, validatedDevices: [device] }),
  );
  for (const path of ["packages/ftms/package.json", "apps/trainer-lab/package.json"]) {
    const file = join(root, path);
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    manifest.version = "0.3.0";
    if (manifest.dependencies) manifest.dependencies["@open-trainer/ftms"] = "0.3.0";
    writeFileSync(file, JSON.stringify(manifest));
  }
  const lockPath = join(root, "package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  lock.version = "0.3.0";
  lock.packages[""].version = "0.3.0";
  lock.packages["packages/ftms"].version = "0.3.0";
  writeFileSync(lockPath, JSON.stringify(lock));

  assert.match(assertReleaseReady(root, "latest"), /Validated 1/);
});

test("hardware evidence becomes stale after compiler, dependency, or build setting changes", (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const device = addDevice(root);
  writeFileSync(
    join(root, "hardware", "compatibility.json"),
    JSON.stringify({ schemaVersion: 1, validatedDevices: [device] }),
  );
  const changes = [
    [
      "tsconfig.base.json",
      (config) => {
        config.compilerOptions.target = "ES2023";
      },
    ],
    [
      "package-lock.json",
      (lock) => {
        lock.packages["node_modules/@typescript/native"].version = "7.0.3";
      },
    ],
    [
      "packages/ftms/package.json",
      (manifest) => {
        manifest.dependencies = { "runtime-helper": "2.0.0" };
      },
    ],
  ];
  for (const [path, update] of changes) {
    const file = join(root, path);
    const original = readFileSync(file, "utf8");
    const parsed = JSON.parse(original);
    update(parsed);
    writeFileSync(file, JSON.stringify(parsed));
    assert.throws(() => assertReleaseReady(root, "latest"), /different library.*runtime/);
    writeFileSync(file, original);
    assert.match(assertReleaseReady(root, "latest"), /Validated 1/);
  }
});

test("reports cannot escape the evidence directory through a symbolic link", (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const device = addDevice(root);
  const report = readFileSync(join(root, device.report), "utf8");
  const outside = join(root, "outside.json");
  writeFileSync(outside, report);
  device.report = "hardware/reports/escaped.json";
  symlinkSync(outside, join(root, device.report));
  writeFileSync(
    join(root, "hardware", "compatibility.json"),
    JSON.stringify({ schemaVersion: 1, validatedDevices: [device] }),
  );

  assert.throws(() => assertReleaseReady(root, "latest"), /outside hardware\/reports/);
});

test("manufacturer spelling case and padding cannot satisfy the two-manufacturer gate", (context) => {
  const root = fixture("1.0.0");
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const devices = [addDevice(root, "Wahoo"), addDevice(root, " WAHOO ")];
  writeFileSync(
    join(root, "hardware", "compatibility.json"),
    JSON.stringify({ schemaVersion: 1, validatedDevices: devices }),
  );

  assert.throws(() => assertReleaseReady(root, "latest"), /two trainer manufacturers/);
});
