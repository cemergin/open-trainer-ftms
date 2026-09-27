/** Bluetooth SIG-assigned UUIDs used by the Fitness Machine Service. */
export const FTMS_UUIDS = {
  service: 0x1826,
  feature: 0x2acc,
  indoorBikeData: 0x2ad2,
  trainingStatus: 0x2ad3,
  supportedResistanceRange: 0x2ad6,
  supportedPowerRange: 0x2ad8,
  controlPoint: 0x2ad9,
  machineStatus: 0x2ada,
} as const;

export type FtmsCharacteristicUuid = (typeof FTMS_UUIDS)[Exclude<
  keyof typeof FTMS_UUIDS,
  "service"
>];
