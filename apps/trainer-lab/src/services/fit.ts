import {
  Encoder,
  Profile,
  Utils,
  type FileIdMesg,
  type DeviceInfoMesg,
  type EventMesg,
  type RecordMesg,
  type LapMesg,
  type SessionMesg,
  type ActivityMesg,
} from "@garmin/fitsdk";
import type { RideRecord, RideSample } from "../ride";

/** Garmin's encoder owns FIT field scaling, message definitions, and CRC generation. */
export function rideFit(ride: RideRecord): Uint8Array<ArrayBuffer> {
  const start = Date.parse(ride.startedAt);
  validateTimeline(ride, start);
  const timestamp = (seconds: number): Date => new Date(start + seconds * 1000);
  const encoder = new Encoder();
  const file: FileIdMesg = {
    type: "activity",
    manufacturer: "development",
    product: 1,
    serialNumber: 1,
    timeCreated: timestamp(0),
  };
  encoder.onMesg(messageNumber("FILE_ID"), file);
  const device: DeviceInfoMesg = {
    timestamp: timestamp(0),
    deviceIndex: "creator",
    manufacturer: "development",
    product: 1,
    productName: ride.simulator ? "Open Trainer Simulator" : "Open Trainer",
  };
  encoder.onMesg(messageNumber("DEVICE_INFO"), device);
  const startEvent: EventMesg = {
    timestamp: timestamp(0),
    event: "timer",
    eventType: "start",
    eventGroup: 0,
  };
  encoder.onMesg(messageNumber("EVENT"), startEvent);
  for (const sample of ride.samples)
    encoder.onMesg(messageNumber("RECORD"), sampleMessage(sample, timestamp(sample.seconds)));
  if (!ride.samples.length)
    encoder.onMesg(messageNumber("RECORD"), { timestamp: timestamp(0) } as RecordMesg);
  const end = timestamp(ride.seconds);
  const stopEvent: EventMesg = {
    timestamp: end,
    event: "timer",
    eventType: "stopAll",
    eventGroup: 0,
  };
  encoder.onMesg(messageNumber("EVENT"), stopEvent);
  const summary: LapMesg = {
    messageIndex: 0,
    timestamp: end,
    startTime: timestamp(0),
    sport: "cycling",
    subSport: "indoorCycling",
    // Ride clocks exclude pauses; older records have no wall-clock pause timeline.
    totalElapsedTime: ride.seconds,
    totalTimerTime: ride.seconds,
    ...(ride.distanceKm > 0 || ride.samples.some((sample) => measured(sample.speed))
      ? { totalDistance: ride.distanceKm * 1000 }
      : {}),
    ...(ride.workKj > 0 ||
    ride.averagePower !== null ||
    ride.samples.some((sample) => measured(sample.watts))
      ? { totalWork: Math.round(ride.workKj * 1000) }
      : {}),
    ...optionalMetric("avgPower", ride.averagePower, 0, 65534),
    ...optionalMetric("maxPower", maximum(ride.samples.map((sample) => sample.watts)), 0, 65534),
  };
  const lap: LapMesg = { ...summary, event: "lap", eventType: "stop", lapTrigger: "sessionEnd" };
  encoder.onMesg(messageNumber("LAP"), lap);
  const session: SessionMesg = {
    ...summary,
    event: "session",
    eventType: "stop",
    firstLapIndex: 0,
    numLaps: 1,
    trigger: "activityEnd",
    sportProfileName: ride.name.slice(0, 100),
  };
  encoder.onMesg(messageNumber("SESSION"), session);
  const activity: ActivityMesg = {
    timestamp: end,
    totalTimerTime: ride.seconds,
    numSessions: 1,
    type: "manual",
    event: "activity",
    eventType: "stop",
  };
  encoder.onMesg(messageNumber("ACTIVITY"), activity);
  return new Uint8Array(encoder.close());
}

function sampleMessage(sample: RideSample, timestamp: Date): RecordMesg {
  return {
    timestamp,
    ...optionalMetric("power", sample.watts, 0, 65534),
    ...optionalMetric("cadence", sample.cadence, 0, 254),
    ...optionalMetric("heartRate", sample.heartRate, 1, 254),
    ...optionalMetric("speed", sample.speed === null ? null : sample.speed / 3.6, 0, 65.534, false),
    ...optionalMetric(
      "distance",
      sample.distanceKm === undefined ? undefined : sample.distanceKm * 1000,
      0,
      42949672.94,
      false,
    ),
    ...optionalMetric("grade", sample.grade, -327.67, 327.67, false),
  };
}

function optionalMetric(
  key: keyof RecordMesg | keyof LapMesg,
  value: number | null | undefined,
  min: number,
  max: number,
  round = true,
): Record<string, number> {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    return {};
  return { [key]: round ? Math.round(value) : value };
}

function maximum(values: (number | null)[]): number | undefined {
  const valid = values.filter(
    (value): value is number =>
      value !== null && Number.isFinite(value) && value >= 0 && value <= 65534,
  );
  return valid.length ? Math.max(...valid) : undefined;
}

function measured(value: number | null): boolean {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function validateTimeline(ride: RideRecord, start: number): void {
  if (
    !Number.isFinite(start) ||
    start < Utils.FIT_EPOCH_MS ||
    !Number.isFinite(ride.seconds) ||
    ride.seconds < 0 ||
    ride.seconds > 86400 ||
    start + ride.seconds * 1000 >= Utils.FIT_EPOCH_MS + 0xffffffff * 1000 ||
    !Number.isFinite(ride.distanceKm) ||
    ride.distanceKm < 0 ||
    ride.distanceKm > 42949 ||
    !Number.isFinite(ride.workKj) ||
    ride.workKj < 0 ||
    ride.workKj > 4294967
  )
    throw new Error("This ride has invalid timing or totals and cannot be exported as FIT.");
  if (ride.samples.length > 100000)
    throw new Error("This ride contains too many samples to export.");
  let previous = 0;
  for (const sample of ride.samples) {
    if (
      !Number.isFinite(sample.seconds) ||
      sample.seconds < previous ||
      sample.seconds > ride.seconds
    )
      throw new Error("This ride contains invalid or out-of-order sample timestamps.");
    previous = sample.seconds;
  }
}

function messageNumber(name: string): number {
  const value = Profile.MesgNum[name];
  if (value === undefined) throw new Error(`The FIT SDK does not support ${name} messages.`);
  return value;
}
