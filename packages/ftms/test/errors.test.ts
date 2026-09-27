import { describe, expect, it } from "vitest";
import {
  FTMS_ERROR_CODE,
  FtmsControlError,
  FtmsError,
  FtmsProtocolError,
  FtmsStateError,
  normalizeFtmsError,
} from "../src/errors.js";

describe("stable FTMS errors", () => {
  it("retains codes, immutable details, names, and causes", () => {
    const cause = new Error("root cause");
    const error = new FtmsStateError("not connected", FTMS_ERROR_CODE.notConnected, {
      cause,
      details: { operation: "start" },
    });

    expect(error).toMatchObject({
      name: "FtmsStateError",
      code: FTMS_ERROR_CODE.notConnected,
      cause,
      details: { operation: "start" },
    });
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  it("normalizes native and non-Error failures without replacing FTMS errors", () => {
    const protocol = new FtmsProtocolError("bad packet");
    expect(normalizeFtmsError(protocol)).toBe(protocol);

    const native = new Error("adapter failed");
    expect(
      normalizeFtmsError(native, "read failed", FTMS_ERROR_CODE.transportFailure),
    ).toMatchObject({
      name: "FtmsError",
      message: "read failed",
      code: FTMS_ERROR_CODE.transportFailure,
      cause: native,
    });
    expect(normalizeFtmsError("radio offline")).toMatchObject({
      message: "An unexpected FTMS operation failed. radio offline",
      code: FTMS_ERROR_CODE.unknown,
    });
  });

  it("exposes control response metadata", () => {
    const response = {
      responseOpcode: 0x80 as const,
      requestOpcode: 0x05,
      resultCode: 0x05,
      responseParameters: new Uint8Array(),
    };
    const error = new FtmsControlError("rejected", response);

    expect(error.response).toBe(response);
    expect(error.details).toEqual({ requestOpcode: 0x05, resultCode: 0x05 });
    expect(error).toBeInstanceOf(FtmsError);
  });
});
