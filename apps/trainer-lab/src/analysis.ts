import type { RideRecord } from "./ride";
export interface RideAnalysis {
  measuredSeconds: number;
  targetSeconds: number;
  onTargetSeconds: number;
  zones: number[];
  cadenceMean: number | null;
  cadenceDeviation: number | null;
  peakPower: number | null;
  targetError: number | null;
}
/** Integrate each sampled interval, excluding gaps rather than treating absent data as zero. */
export function analyzeRide(record: RideRecord, ftp = 200): RideAnalysis {
  if (!Number.isFinite(ftp) || ftp < 25 || ftp > 600)
    throw new Error("Reference FTP must be between 25 and 600 W.");
  const result: RideAnalysis = {
    measuredSeconds: 0,
    targetSeconds: 0,
    onTargetSeconds: 0,
    zones: [0, 0, 0, 0, 0, 0, 0],
    cadenceMean: null,
    cadenceDeviation: null,
    peakPower: null,
    targetError: null,
  };
  let previous = 0,
    cadenceSeconds = 0,
    cadenceSum = 0,
    cadenceSquared = 0,
    errorSum = 0;
  for (const sample of record.samples) {
    const delta = sample.seconds - previous;
    previous = sample.seconds;
    if (delta <= 0 || delta > 5) continue;
    if (sample.watts !== null) {
      const watts = Math.max(0, sample.watts);
      result.measuredSeconds += delta;
      result.peakPower = Math.max(result.peakPower ?? 0, watts);
      const zone = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5].findIndex((limit) => watts / ftp <= limit);
      const zoneIndex = zone === -1 ? 6 : zone;
      result.zones[zoneIndex] = (result.zones[zoneIndex] ?? 0) + delta;
      if ((record.controlMode ?? "erg") === "erg" && sample.target > 0) {
        result.targetSeconds += delta;
        errorSum += Math.abs(watts - sample.target) * delta;
        if (Math.abs(watts - sample.target) <= Math.max(5, sample.target * 0.05))
          result.onTargetSeconds += delta;
      }
    }
    if (sample.cadence !== null && sample.cadence >= 0) {
      cadenceSeconds += delta;
      cadenceSum += sample.cadence * delta;
      cadenceSquared += sample.cadence ** 2 * delta;
    }
  }
  if (cadenceSeconds > 0) {
    result.cadenceMean = cadenceSum / cadenceSeconds;
    result.cadenceDeviation = Math.sqrt(
      Math.max(0, cadenceSquared / cadenceSeconds - result.cadenceMean ** 2),
    );
  }
  if (result.targetSeconds > 0) result.targetError = errorSum / result.targetSeconds;
  return result;
}
