import type { ControlPointResponse } from "./types.js";

export const FTMS_ERROR_CODE = {
  unknown: "unknown",
  bluetoothUnavailable: "bluetooth_unavailable",
  notConnected: "not_connected",
  invalidState: "invalid_state",
  invalidPacket: "invalid_packet",
  unsupportedCapability: "unsupported_capability",
  valueOutOfRange: "value_out_of_range",
  controlRejected: "control_rejected",
  commandTimeout: "command_timeout",
  commandDesynchronized: "command_desynchronized",
  commandSuperseded: "command_superseded",
  operationClosed: "operation_closed",
  transportFailure: "transport_failure",
} as const;

export type FtmsErrorCode = (typeof FTMS_ERROR_CODE)[keyof typeof FTMS_ERROR_CODE];

export interface FtmsErrorOptions extends ErrorOptions {
  code?: FtmsErrorCode;
  details?: Readonly<Record<string, unknown>>;
}

export class FtmsError extends Error {
  readonly code: FtmsErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(message: string, options: FtmsErrorOptions = {}) {
    super(message, options);
    this.name = "FtmsError";
    this.code = options.code ?? FTMS_ERROR_CODE.unknown;
    this.details = options.details ? Object.freeze({ ...options.details }) : undefined;
  }
}

export class FtmsProtocolError extends FtmsError {
  constructor(message: string, options: Omit<FtmsErrorOptions, "code"> = {}) {
    super(message, { ...options, code: FTMS_ERROR_CODE.invalidPacket });
    this.name = "FtmsProtocolError";
  }
}

export class FtmsCapabilityError extends FtmsError {
  constructor(message: string, options: Omit<FtmsErrorOptions, "code"> = {}) {
    super(message, { ...options, code: FTMS_ERROR_CODE.unsupportedCapability });
    this.name = "FtmsCapabilityError";
  }
}

export class FtmsRangeError extends FtmsError {
  constructor(message: string, options: Omit<FtmsErrorOptions, "code"> = {}) {
    super(message, { ...options, code: FTMS_ERROR_CODE.valueOutOfRange });
    this.name = "FtmsRangeError";
  }
}

export class FtmsStateError extends FtmsError {
  constructor(
    message: string,
    code: FtmsErrorCode = FTMS_ERROR_CODE.invalidState,
    options: Omit<FtmsErrorOptions, "code"> = {},
  ) {
    super(message, { ...options, code });
    this.name = "FtmsStateError";
  }
}

export class FtmsTimeoutError extends FtmsError {
  constructor(message: string, options: Omit<FtmsErrorOptions, "code"> = {}) {
    super(message, { ...options, code: FTMS_ERROR_CODE.commandTimeout });
    this.name = "FtmsTimeoutError";
  }
}

export class FtmsCommandSupersededError extends FtmsError {
  constructor(message: string, options: Omit<FtmsErrorOptions, "code"> = {}) {
    super(message, { ...options, code: FTMS_ERROR_CODE.commandSuperseded });
    this.name = "FtmsCommandSupersededError";
  }
}

export class FtmsControlError extends FtmsError {
  readonly response: ControlPointResponse;

  constructor(message: string, response: ControlPointResponse) {
    super(message, {
      code: FTMS_ERROR_CODE.controlRejected,
      details: {
        requestOpcode: response.requestOpcode,
        resultCode: response.resultCode,
      },
    });
    this.name = "FtmsControlError";
    this.response = response;
  }
}

export function normalizeFtmsError(
  error: unknown,
  message = "An unexpected FTMS operation failed.",
  code: FtmsErrorCode = FTMS_ERROR_CODE.unknown,
): FtmsError {
  if (error instanceof FtmsError) return error;
  if (error instanceof Error) return new FtmsError(message, { cause: error, code });
  return new FtmsError(`${message} ${String(error)}`, { code });
}
