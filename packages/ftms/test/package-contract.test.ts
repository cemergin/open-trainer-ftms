import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as publicApi from "../src/index.js";
import * as rawApi from "../src/raw.js";
import * as testingApi from "../src/testing.js";
import * as transportApi from "../src/transport.js";
import * as webBluetoothApi from "../src/web-bluetooth.js";

describe("published package contract", () => {
  it("keeps implementation-specific APIs out of the root entry point", () => {
    expect(publicApi).not.toHaveProperty("MockFtmsTransport");
    expect(publicApi).not.toHaveProperty("WebBluetoothFtmsTransport");
    expect(publicApi).not.toHaveProperty("targetPowerCommand");
    expect(rawApi).toHaveProperty("targetPowerCommand");
    expect(testingApi).toHaveProperty("createMockTrainer");
    expect(transportApi).toHaveProperty("createTrainer");
    expect(webBluetoothApi).toHaveProperty("createWebBluetoothTrainer");
  });

  it("declares explicit typed subpath exports and publish files", () => {
    const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
      types?: string;
      files?: string[];
      exports?: Record<string, unknown>;
      dependencies?: Record<string, string>;
      publishConfig?: { access?: string };
    };

    expect(packageJson.types).toBe("./dist/index.d.ts");
    expect(Object.keys(packageJson.exports ?? {})).toEqual([
      ".",
      "./web-bluetooth",
      "./testing",
      "./transport",
      "./raw",
    ]);
    expect(packageJson.files).toContain("LICENSE");
    expect(packageJson.files).toContain("src");
    expect(packageJson.dependencies).toHaveProperty("@types/web-bluetooth");
    expect(packageJson.publishConfig?.access).toBe("public");
  });
});
