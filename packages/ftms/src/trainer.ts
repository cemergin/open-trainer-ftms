import {
  pauseCommand,
  requestControlCommand,
  resetCommand,
  simulationCommand,
  startCommand,
  stopCommand,
  targetPowerCommand,
  targetResistanceCommand,
} from "./commands.js";
import { ControlPointQueue } from "./control-point-queue.js";
import { FtmsCapabilityError, FtmsControlError, FtmsError } from "./errors.js";
import {
  parseCapabilities,
  parseIndoorBikeData,
  parseSupportedPowerRange,
  parseSupportedResistanceRange,
} from "./parsers.js";
import { EventSource, StateSource } from "./reactive.js";
import {
  CONTROL_RESULT,
  type ControlPointResponse,
  type FtmsTransport,
  type SimulationParameters,
  type Trainer,
  type TrainerCapabilities,
  type TrainerOptions,
  type TrainerTelemetry,
  type Unsubscribe,
} from "./types.js";
import { FTMS_UUIDS } from "./uuids.js";

const RESULT_LABELS: Record<number, string> = {
  0x02: "not supported",
  0x03: "invalid parameter",
  0x04: "operation failed",
  0x05: "control not permitted",
};

export class FtmsTrainer implements Trainer {
  readonly #connectionSource = new StateSource<Trainer["connection"]["current"]>("disconnected");
  readonly #controlSource = new StateSource<Trainer["control"]["current"]>("unavailable");
  readonly #activitySource = new StateSource<Trainer["activity"]["current"]>("idle");
  readonly #capabilitySource = new StateSource<TrainerCapabilities | null>(null);
  readonly #telemetrySource = new StateSource<TrainerTelemetry | null>(null);
  readonly #controlResponseSource = new EventSource<ControlPointResponse>();
  readonly #machineStatusSource = new EventSource<Uint8Array>();
  readonly #errorSource = new EventSource<Error>();

  readonly connection = this.#connectionSource.asReadonly();
  readonly control = this.#controlSource.asReadonly();
  readonly activity = this.#activitySource.asReadonly();
  readonly capabilities = this.#capabilitySource.asReadonly();
  readonly telemetry = this.#telemetrySource.asReadonly();
  readonly controlResponses = this.#controlResponseSource.asReadonly();
  readonly machineStatus = this.#machineStatusSource.asReadonly();
  readonly errors = this.#errorSource.asReadonly();

  #queue: ControlPointQueue | undefined;
  #subscriptions: Unsubscribe[] = [];
  readonly #options: Required<TrainerOptions>;

  constructor(
    private readonly transport: FtmsTransport,
    options: TrainerOptions = {},
  ) {
    this.#options = {
      commandTimeoutMs: options.commandTimeoutMs ?? 4_000,
      autoStartTelemetry: options.autoStartTelemetry ?? true,
    };
  }

  get deviceName(): string | undefined {
    return this.transport.deviceName;
  }

  async connect(): Promise<TrainerCapabilities> {
    if (this.transport.isConnected && this.#capabilitySource.current) {
      return this.#capabilitySource.current;
    }
    this.#connectionSource.setIfChanged("connecting");

    try {
      await this.transport.connect();
      this.#subscriptions.push(
        this.transport.onDisconnect(() => this.#handleDisconnect("Bluetooth connection lost.")),
      );

      this.#queue = new ControlPointQueue(this.transport, this.#options.commandTimeoutMs);
      await this.#queue.open();
      this.#subscriptions.push(
        this.#queue.responses.subscribe((response) => this.#controlResponseSource.emit(response)),
      );

      const capabilities = parseCapabilities(await this.transport.read(FTMS_UUIDS.feature));
      if (capabilities.supportsPowerTarget) {
        const powerRange = await this.#readOptionalRange(
          FTMS_UUIDS.supportedPowerRange,
          parseSupportedPowerRange,
        );
        if (powerRange) capabilities.powerRange = powerRange;
      }
      if (capabilities.supportsResistanceTarget) {
        const resistanceRange = await this.#readOptionalRange(
          FTMS_UUIDS.supportedResistanceRange,
          parseSupportedResistanceRange,
        );
        if (resistanceRange) capabilities.resistanceRange = resistanceRange;
      }
      this.#capabilitySource.set(capabilities);

      if (this.#options.autoStartTelemetry) {
        this.#subscriptions.push(
          await this.transport.subscribe(FTMS_UUIDS.indoorBikeData, (value) => {
            try {
              this.#telemetrySource.set(parseIndoorBikeData(value));
            } catch (error) {
              this.#errorSource.emit(error instanceof Error ? error : new FtmsError(String(error)));
            }
          }),
        );
      }

      try {
        this.#subscriptions.push(
          await this.transport.subscribe(FTMS_UUIDS.machineStatus, (value) => {
            this.#machineStatusSource.emit(
              new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)),
            );
          }),
        );
      } catch {
        // Machine Status is useful but not mandatory for basic trainer operation.
      }

      this.#connectionSource.set("ready");
      return capabilities;
    } catch (error) {
      this.#connectionSource.set("error");
      this.#errorSource.emit(error instanceof Error ? error : new FtmsError(String(error)));
      await this.#cleanup(true);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.#cleanup(true);
    this.#connectionSource.setIfChanged("disconnected");
  }

  async acquireControl(): Promise<ControlPointResponse> {
    this.#controlSource.set("requesting");
    try {
      const response = await this.#command(requestControlCommand());
      this.#controlSource.set("owned");
      return response;
    } catch (error) {
      this.#controlSource.set("unavailable");
      throw error;
    }
  }

  async start(): Promise<ControlPointResponse> {
    const response = await this.#command(startCommand());
    this.#activitySource.set("running");
    return response;
  }

  async pause(): Promise<ControlPointResponse> {
    const response = await this.#command(pauseCommand());
    this.#activitySource.set("paused");
    return response;
  }

  async stop(): Promise<ControlPointResponse> {
    this.#activitySource.set("stopping");
    try {
      const response = await this.#command(stopCommand());
      this.#activitySource.set("idle");
      return response;
    } catch (error) {
      this.#activitySource.set("idle");
      this.#errorSource.emit(error instanceof Error ? error : new FtmsError(String(error)));
      throw error;
    }
  }

  async reset(): Promise<ControlPointResponse> {
    const response = await this.#command(resetCommand());
    this.#controlSource.set("unavailable");
    this.#activitySource.set("idle");
    return response;
  }

  async setTargetPower(watts: number): Promise<ControlPointResponse> {
    const capabilities = this.#requireCapabilities();
    if (!capabilities.supportsPowerTarget) {
      throw new FtmsCapabilityError("This trainer does not advertise power target control.");
    }
    this.#assertRange(watts, capabilities.powerRange, "Target power");
    return this.#command(targetPowerCommand(watts));
  }

  async setResistanceLevel(level: number): Promise<ControlPointResponse> {
    const capabilities = this.#requireCapabilities();
    if (!capabilities.supportsResistanceTarget) {
      throw new FtmsCapabilityError("This trainer does not advertise resistance target control.");
    }
    this.#assertRange(level, capabilities.resistanceRange, "Resistance level");
    return this.#command(targetResistanceCommand(level));
  }

  async setSimulation(parameters: SimulationParameters): Promise<ControlPointResponse> {
    if (!this.#requireCapabilities().supportsSimulation) {
      throw new FtmsCapabilityError("This trainer does not advertise indoor bike simulation control.");
    }
    return this.#command(simulationCommand(parameters));
  }

  async #command(command: Uint8Array): Promise<ControlPointResponse> {
    if (!this.transport.isConnected || !this.#queue) {
      throw new FtmsError("Connect to a trainer before sending control commands.");
    }
    const response = await this.#queue.execute(command);
    if (response.resultCode !== CONTROL_RESULT.success) {
      const label = RESULT_LABELS[response.resultCode] ?? `result 0x${response.resultCode.toString(16)}`;
      throw new FtmsControlError(`FTMS command 0x${response.requestOpcode.toString(16)} failed: ${label}.`, response);
    }
    return response;
  }

  #requireCapabilities(): TrainerCapabilities {
    if (!this.#capabilitySource.current) {
      throw new FtmsError("Trainer capabilities are unavailable before connect().");
    }
    return this.#capabilitySource.current;
  }

  #assertRange(value: number, range: TrainerCapabilities["powerRange"], label: string): void {
    if (!Number.isFinite(value)) throw new FtmsError(`${label} must be a finite number.`);
    if (range && (value < range.minimum || value > range.maximum)) {
      throw new FtmsCapabilityError(
        `${label} ${value} is outside the trainer's range ${range.minimum}–${range.maximum}.`,
      );
    }
  }

  async #readOptionalRange(
    uuid: number,
    parse: (view: DataView) => NonNullable<TrainerCapabilities["powerRange"]>,
  ): Promise<NonNullable<TrainerCapabilities["powerRange"]> | undefined> {
    try {
      return parse(await this.transport.read(uuid));
    } catch {
      return undefined;
    }
  }

  #handleDisconnect(reason: string): void {
    this.#queue?.close(reason);
    this.#queue = undefined;
    for (const unsubscribe of this.#subscriptions.splice(0)) unsubscribe();
    this.#capabilitySource.set(null);
    this.#telemetrySource.set(null);
    this.#controlSource.set("unavailable");
    this.#activitySource.set("idle");
    this.#connectionSource.set("disconnected");
  }

  async #cleanup(disconnectTransport: boolean): Promise<void> {
    this.#queue?.close();
    this.#queue = undefined;
    for (const unsubscribe of this.#subscriptions.splice(0)) unsubscribe();
    this.#capabilitySource.set(null);
    this.#telemetrySource.set(null);
    this.#controlSource.setIfChanged("unavailable");
    this.#activitySource.setIfChanged("idle");
    if (disconnectTransport && this.transport.isConnected) await this.transport.disconnect();
  }
}
