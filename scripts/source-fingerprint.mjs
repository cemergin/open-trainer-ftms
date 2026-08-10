import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const RUNTIME_SOURCE_ROOTS = [join("packages", "ftms", "src"), join("apps", "trainer-lab", "src")];

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

export function computeRuntimeFingerprint(workspaceRoot) {
  const hash = createHash("sha256");
  for (const sourceRoot of RUNTIME_SOURCE_ROOTS) {
    for (const path of filesRecursively(join(workspaceRoot, sourceRoot)).filter(isRuntimeSource)) {
      hash.update(relative(workspaceRoot, path).split(sep).join("/"));
      hash.update("\0");
      hash.update(readFileSync(path, "utf8").replaceAll("\r\n", "\n"));
      hash.update("\0");
    }
  }
  return hash.digest("hex");
}
