import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const RUNTIME_SOURCE_ROOTS = [join("packages", "ftms", "src"), join("apps", "trainer-lab", "src")];
const BUILD_INPUTS = [
  "tsconfig.base.json",
  "packages/ftms/tsconfig.json",
  "apps/trainer-lab/vite.config.ts",
];
const WORKSPACE_MANIFESTS = ["packages/ftms/package.json", "apps/trainer-lab/package.json"];

function isRuntimeSource(path) {
  return !path.endsWith(".test.ts") && !path.endsWith(".d.ts");
}

function filesRecursively(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesRecursively(path) : [path];
    })
    .sort();
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, entry]) => [key, stableJson(entry)]),
    );
  }
  return value;
}

function readJson(workspaceRoot, path) {
  return JSON.parse(readFileSync(join(workspaceRoot, path), "utf8"));
}

export function computeRuntimeFingerprint(workspaceRoot) {
  const hash = createHash("sha256");
  const add = (path, content) => {
    hash.update(path.split(sep).join("/"));
    hash.update("\0");
    hash.update(content.replaceAll("\r\n", "\n"));
    hash.update("\0");
  };
  const addJson = (path, value) => add(path, JSON.stringify(stableJson(value)));
  for (const sourceRoot of RUNTIME_SOURCE_ROOTS) {
    for (const path of filesRecursively(join(workspaceRoot, sourceRoot)).filter(isRuntimeSource)) {
      add(relative(workspaceRoot, path), readFileSync(path, "utf8"));
    }
  }
  for (const path of BUILD_INPUTS) add(path, readFileSync(join(workspaceRoot, path), "utf8"));

  const manifests = WORKSPACE_MANIFESTS.map((path) => [path, readJson(workspaceRoot, path)]);
  const workspaceNames = new Set(manifests.map(([, manifest]) => manifest.name));
  for (const [path, manifest] of manifests) {
    const runtimeMetadata = Object.fromEntries(
      ["type", "exports", "engines", "dependencies", "optionalDependencies", "peerDependencies"]
        .filter((field) => manifest[field] !== undefined)
        .map((field) => [field, manifest[field]]),
    );
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      if (!runtimeMetadata[field]) continue;
      runtimeMetadata[field] = Object.fromEntries(
        Object.entries(runtimeMetadata[field]).map(([name, version]) => [
          name,
          workspaceNames.has(name) ? "workspace" : version,
        ]),
      );
    }
    addJson(path, runtimeMetadata);
  }

  const lock = readJson(workspaceRoot, "package-lock.json");
  const dependencies = Object.fromEntries(
    Object.entries(lock.packages).filter(
      ([path, entry]) => path.includes("node_modules/") && !entry.link,
    ),
  );
  addJson("package-lock.json", { lockfileVersion: lock.lockfileVersion, packages: dependencies });
  return hash.digest("hex");
}
