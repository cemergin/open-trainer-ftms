import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { computeRuntimeFingerprint } from "../../scripts/source-fingerprint.mjs";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
const packageMetadata = JSON.parse(
  readFileSync(new URL("../../packages/ftms/package.json", import.meta.url), "utf8"),
) as { version?: unknown };
if (typeof packageMetadata.version !== "string") {
  throw new Error("The FTMS package version is unavailable.");
}
const sourceCommit =
  process.env.GITHUB_SHA ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" }).trim();
if (!/^[0-9a-f]{40}$/i.test(sourceCommit)) throw new Error("The source commit is unavailable.");
const runtimeFingerprint = computeRuntimeFingerprint(workspaceRoot);

export default defineConfig({
  define: {
    __FTMS_PACKAGE_VERSION__: JSON.stringify(packageMetadata.version),
    __SOURCE_COMMIT__: JSON.stringify(sourceCommit),
    __RUNTIME_FINGERPRINT__: JSON.stringify(runtimeFingerprint),
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
});
