import type { ControlPointResponse } from "./types.js";

export class FtmsError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FtmsError";
  }
}

export class FtmsProtocolError extends FtmsError {
  constructor(message: string) {
    super(message);
    this.name = "FtmsProtocolError";
  }
}

export class FtmsCapabilityError extends FtmsError {
  constructor(message: string) {
    super(message);
    this.name = "FtmsCapabilityError";
  }
}

export class FtmsControlError extends FtmsError {
  readonly response: ControlPointResponse;

  constructor(message: string, response: ControlPointResponse) {
    super(message);
    this.name = "FtmsControlError";
    this.response = response;
  }
}
