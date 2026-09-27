/** Bluetooth SIG HRS, CSCS and CPS measurement layouts, little-endian. */
export function parseHeartRate(value: DataView): number | null {
  if (value.byteLength < 2) throw new Error("Truncated heart-rate measurement.");
  const flags = value.getUint8(0);
  const wide = Boolean(flags & 1);
  const end = 1 + (wide ? 2 : 1) + (flags & 8 ? 2 : 0);
  const rrBytes = value.byteLength - end;
  if (
    flags & 0xe0 ||
    rrBytes < 0 ||
    (flags & 16 ? rrBytes < 2 || rrBytes % 2 !== 0 : rrBytes !== 0)
  )
    throw new Error("Invalid heart-rate measurement layout.");
  const contactSupported = Boolean(flags & 4);
  if (contactSupported && !(flags & 2)) return null;
  return wide ? value.getUint16(1, true) : value.getUint8(1);
}

export interface CrankMeasurement {
  revolutions: number;
  eventTime: number;
}

export function parseCadence(value: DataView): CrankMeasurement | null {
  if (value.byteLength < 1) throw new Error("Truncated CSC measurement.");
  const flags = value.getUint8(0);
  const crankOffset = 1 + (flags & 1 ? 6 : 0);
  const expectedLength = crankOffset + (flags & 2 ? 4 : 0);
  if (flags === 0 || flags & 0xfc || value.byteLength !== expectedLength)
    throw new Error("Invalid CSC measurement layout.");
  return flags & 2
    ? {
        revolutions: value.getUint16(crankOffset, true),
        eventTime: value.getUint16(crankOffset + 2, true),
      }
    : null;
}

export function parseCyclingPower(value: DataView): number {
  if (value.byteLength < 4) throw new Error("Truncated cycling-power measurement.");
  const flags = value.getUint16(0, true);
  // Bits 1, 3, and 12 describe fields; only presence bits add payload bytes.
  const optionalFields = [
    [0, 1],
    [2, 2],
    [4, 6],
    [5, 4],
    [6, 4],
    [7, 4],
    [8, 3],
    [9, 2],
    [10, 2],
    [11, 2],
  ] as const;
  const expectedLength = optionalFields.reduce(
    (length, [bit, bytes]) => length + (flags & (1 << bit) ? bytes : 0),
    4,
  );
  if (flags & 0xe000 || value.byteLength !== expectedLength)
    throw new Error("Invalid cycling-power measurement layout.");
  return value.getInt16(2, true);
}

/** Event time and crank count are uint16 and both wrap. Reset after long gaps. */
export class CrankCadence {
  #previous: (CrankMeasurement & { receivedAt: number }) | undefined;
  #lastMovementAt: number | undefined;
  #lastCadence: number | null = null;

  reset(): void {
    this.#previous = undefined;
    this.#lastMovementAt = undefined;
    this.#lastCadence = null;
  }

  update(measurement: CrankMeasurement, now: number): number | null {
    const previous = this.#previous;
    this.#previous = { ...measurement, receivedAt: now };
    if (!previous || now - previous.receivedAt >= 64_000 || now < previous.receivedAt) {
      this.#lastMovementAt = now;
      this.#lastCadence = null;
      return null;
    }
    const revolutions = (measurement.revolutions - previous.revolutions + 0x10000) % 0x10000;
    const ticks = (measurement.eventTime - previous.eventTime + 0x10000) % 0x10000;
    if (revolutions === 0) {
      if (this.#lastMovementAt !== undefined && now - this.#lastMovementAt >= 3000)
        this.#lastCadence = 0;
      return this.#lastCadence;
    }
    const cadence = ticks === 0 ? Infinity : (revolutions * 60 * 1024) / ticks;
    this.#lastMovementAt = now;
    // Reject counter resets and corrupt spikes while retaining a new baseline.
    this.#lastCadence = cadence <= 300 ? cadence : null;
    return this.#lastCadence;
  }
}
