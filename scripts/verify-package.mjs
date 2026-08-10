import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDirectory = join(workspaceRoot, "packages", "ftms");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "open-trainer-package-"));
const consumerDirectory = join(temporaryDirectory, "consumer");
const executableSuffix = process.platform === "win32" ? ".cmd" : "";
const npmCommand = `npm${executableSuffix}`;

function run(command, args, cwd = workspaceRoot) {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE ?? join(tmpdir(), "open-trainer-npm-cache"),
    },
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
  }
}

try {
  run(npmCommand, ["pack", packageDirectory, "--pack-destination", temporaryDirectory, "--silent"]);

  const tarballs = readdirSync(temporaryDirectory).filter((file) => file.endsWith(".tgz"));
  if (tarballs.length !== 1) {
    throw new Error(`Expected one package tarball, found ${tarballs.length}.`);
  }

  const tarball = join(temporaryDirectory, tarballs[0]);
  const binaryDirectory = join(workspaceRoot, "node_modules", ".bin");

  run(join(binaryDirectory, `publint${executableSuffix}`), [tarball, "--strict"]);
  run(join(binaryDirectory, `attw${executableSuffix}`), [tarball, "--profile", "esm-only"]);

  mkdirSync(consumerDirectory);
  writeFileSync(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );
  run(
    npmCommand,
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    consumerDirectory,
  );

  const smokeTest = `
    const root = await import("@open-trainer/ftms");
    const raw = await import("@open-trainer/ftms/raw");
    const testing = await import("@open-trainer/ftms/testing");
    const transport = await import("@open-trainer/ftms/transport");
    const webBluetooth = await import("@open-trainer/ftms/web-bluetooth");

    if (typeof root.mapState !== "function") throw new Error("Root export failed.");
    if (typeof raw.targetPowerCommand !== "function") throw new Error("Raw export failed.");
    if (typeof transport.createTrainer !== "function") throw new Error("Transport export failed.");
    if (typeof webBluetooth.createWebBluetoothTrainer !== "function") throw new Error("Web Bluetooth export failed.");

    const trainer = testing.createMockTrainer();
    await trainer.connect();
    if (trainer.connection.current !== "ready") throw new Error("Installed simulator failed to connect.");
    await trainer.disconnect();
  `;

  run(process.execPath, ["--input-type=module", "--eval", smokeTest], consumerDirectory);
  console.log("Verified packed metadata, types, exports, installation, and runtime imports.");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
