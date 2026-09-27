import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyQualificationChecks, type QualificationMetadata } from "../qualification.js";
import { loadQualificationDraft, saveQualificationDraft } from "./qualification-storage.js";

const metadata: QualificationMetadata = {
  packageVersion: "0.1.0",
  sourceCommit: "a".repeat(40),
  runtimeFingerprint: "b".repeat(64),
  manufacturer: "Wahoo",
  model: "KICKR CORE",
  firmware: "1",
  resistanceControlFormat: "sint16",
  operatingSystem: "macOS",
  browser: "Chrome",
  browserVersion: "140",
  secureContext: true,
  notes: "",
};
afterEach(() => vi.unstubAllGlobals());

describe("qualification draft storage", () => {
  it("stores only metadata and notes, never certification or live evidence", () => {
    let stored: string | null = null;
    vi.stubGlobal("localStorage", {
      getItem: () => stored,
      setItem: (_: string, value: string) => {
        stored = value;
      },
    });
    const checks = createEmptyQualificationChecks();
    checks.stop = { passed: true, notes: "Observed stop" };
    expect(saveQualificationDraft(metadata, checks)).toBe(true);
    const draft = loadQualificationDraft(metadata.runtimeFingerprint);
    expect(draft.metadata).toMatchObject({ manufacturer: "Wahoo", model: "KICKR CORE" });
    expect(draft.notes.stop).toBe("Observed stop");
    expect(stored).not.toContain('"passed"');
    expect(stored).not.toContain('"secureContext"');
    expect(loadQualificationDraft("changed runtime").notes).toEqual({});
  });

  it("handles disabled storage without attempting further denied operations", () => {
    const denied = (): never => {
      throw new Error("Storage denied");
    };
    vi.stubGlobal("localStorage", { getItem: denied, setItem: denied });
    expect(loadQualificationDraft(metadata.runtimeFingerprint)).toEqual({
      metadata: {},
      notes: {},
      available: false,
    });
    expect(saveQualificationDraft(metadata, createEmptyQualificationChecks())).toBe(false);
  });

  it("ignores malformed data and injected pass or build metadata", () => {
    vi.stubGlobal("localStorage", { getItem: () => "broken JSON" });
    expect(loadQualificationDraft(metadata.runtimeFingerprint).available).toBe(false);
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({
          runtimeFingerprint: metadata.runtimeFingerprint,
          metadata: {
            manufacturer: 9,
            model: "KICKR CORE",
            secureContext: true,
            sourceCommit: "spoof",
          },
          checks: { stop: { passed: true, notes: "Saved note" } },
        }),
    });
    expect(loadQualificationDraft(metadata.runtimeFingerprint)).toEqual({
      metadata: { model: "KICKR CORE" },
      notes: { stop: "Saved note" },
      available: true,
    });
  });
});
