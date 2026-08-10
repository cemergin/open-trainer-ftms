import { describe, expect, it } from "vitest";
import { CONTROL_OPCODE } from "../src/commands.js";
import { MockFtmsTransport } from "../src/mock-transport.js";
import { CONTROL_RESULT } from "../src/types.js";
import { FTMS_UUIDS } from "../src/uuids.js";

describe("MockFtmsTransport protocol behavior", () => {
  it("enforces connection and characteristic access", async () => {
    const transport = new MockFtmsTransport();
    await expect(transport.read(FTMS_UUIDS.feature)).rejects.toThrow(/disconnected/);
    await transport.connect();

    await expect(transport.read(0xffff)).rejects.toThrow(/not readable/);
    await expect(transport.write(FTMS_UUIDS.feature, Uint8Array.of(1))).rejects.toThrow(
      /not writable/,
    );
    await expect(transport.write(FTMS_UUIDS.controlPoint, new Uint8Array())).rejects.toThrow(
      /empty command/,
    );
    await transport.disconnect();
    expect(() => transport.emitNotification(FTMS_UUIDS.machineStatus, Uint8Array.of(1))).toThrow(
      /disconnected/,
    );
  });

  it("returns FTMS result codes for rejected and malformed procedures", async () => {
    const transport = new MockFtmsTransport();
    await transport.connect();
    const responses: number[][] = [];
    const unsubscribe = await transport.subscribe(FTMS_UUIDS.controlPoint, (view) => {
      responses.push([...new Uint8Array(view.buffer, view.byteOffset, view.byteLength)]);
    });

    await transport.write(FTMS_UUIDS.controlPoint, Uint8Array.of(CONTROL_OPCODE.startResume));
    await transport.write(FTMS_UUIDS.controlPoint, Uint8Array.of(0x7f));
    await transport.write(FTMS_UUIDS.controlPoint, Uint8Array.of(CONTROL_OPCODE.requestControl));
    await transport.write(FTMS_UUIDS.controlPoint, Uint8Array.of(CONTROL_OPCODE.setTargetPower));
    await transport.write(
      FTMS_UUIDS.controlPoint,
      Uint8Array.of(CONTROL_OPCODE.setTargetResistance),
    );
    await transport.write(FTMS_UUIDS.controlPoint, Uint8Array.of(CONTROL_OPCODE.setSimulation));
    await Promise.resolve();

    expect(responses).toEqual([
      [0x80, CONTROL_OPCODE.startResume, CONTROL_RESULT.controlNotPermitted],
      [0x80, 0x7f, CONTROL_RESULT.notSupported],
      [0x80, CONTROL_OPCODE.requestControl, CONTROL_RESULT.success],
      [0x80, CONTROL_OPCODE.setTargetPower, CONTROL_RESULT.invalidParameter],
      [0x80, CONTROL_OPCODE.setTargetResistance, CONTROL_RESULT.invalidParameter],
      [0x80, CONTROL_OPCODE.setSimulation, CONTROL_RESULT.invalidParameter],
    ]);
    unsubscribe();
    await transport.disconnect();
  });
});
