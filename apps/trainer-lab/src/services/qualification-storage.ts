import {
  QUALIFICATION_CHECKS,
  type QualificationChecksState,
  type QualificationMetadata,
  type QualificationCheckId,
} from "../qualification.js";

const KEY = "open-trainer-qualification-v1";
const metadataKeys = [
  "manufacturer",
  "model",
  "firmware",
  "operatingSystem",
  "browser",
  "browserVersion",
  "notes",
] as const;
type DraftMetadata = Pick<
  QualificationMetadata,
  (typeof metadataKeys)[number] | "resistanceControlFormat"
>;
interface QualificationDraft {
  metadata: Partial<DraftMetadata>;
  notes: Partial<Record<QualificationCheckId, string>>;
  available: boolean;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function loadQualificationDraft(fingerprint: string): QualificationDraft {
  const draft: QualificationDraft = { metadata: {}, notes: {}, available: true };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return draft;
    const saved: unknown = JSON.parse(raw);
    if (!record(saved)) return draft;
    if (record(saved.metadata)) {
      for (const key of metadataKeys) {
        const value = saved.metadata[key];
        if (typeof value === "string") draft.metadata[key] = value;
      }
    }
    if (saved.resistanceControlFormat === "sint16" || saved.resistanceControlFormat === "uint8") {
      draft.metadata.resistanceControlFormat = saved.resistanceControlFormat;
    }
    if (saved.runtimeFingerprint === fingerprint && record(saved.checks)) {
      for (const { id } of QUALIFICATION_CHECKS) {
        const check = saved.checks[id];
        if (record(check) && typeof check.notes === "string") draft.notes[id] = check.notes;
      }
    }
  } catch {
    // Storage may be denied, or contain a broken draft. Neither blocks trainer controls.
    draft.available = false;
  }
  return draft;
}
export function saveQualificationDraft(
  metadata: QualificationMetadata,
  checks: QualificationChecksState,
): boolean {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        runtimeFingerprint: metadata.runtimeFingerprint,
        resistanceControlFormat: metadata.resistanceControlFormat,
        metadata: Object.fromEntries(metadataKeys.map((key) => [key, metadata[key]])),
        checks: Object.fromEntries(
          QUALIFICATION_CHECKS.map(({ id }) => [id, { notes: checks[id].notes }]),
        ),
      }),
    );
    return true;
  } catch {
    return false;
  }
}
