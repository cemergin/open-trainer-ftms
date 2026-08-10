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
import { ControlPointQueue, type ControlPointExecutionOptions } from "./control-point-queue.js";
import {
  FTMS_ERROR_CODE,
  FtmsCapabilityError,
  FtmsControlError,
  FtmsError,
  FtmsRangeError,
  FtmsStateError,
  normalizeFtmsError,
} from "./errors.js";
import {
  parseCapabilities,
  parseIndoorBikeData,
  parseMachineStatus,
  parseSupportedPowerRange,
  parseSupportedResistanceRange,
} from "./parsers.js";
import { EventSource, StateSource } from "./reactive.js";
import {
  CONTROL_RESULT,
  type ControlPointResponse,
  type FtmsTransport,
  type MachineStatus,
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
  readonly #errorSource = new EventSource<Error>();
  readonly #reportSubscriberError = (error: unknown): void => {
    this.#errorSource.emit(normalizeFtmsError(error, "An FTMS stream subscriber threw an error."));
  };
  readonly #connectionSource = new StateSource<Trainer["connection"]["current"]>(
    "disconnected",
    this.#reportSubscriberError,
  );
  readonly #controlSource = new StateSource<Trainer["control"]["current"]>(
    "unavailable",
    this.#reportSubscriberError,
  );
  readonly #activitySource = new StateSource<Trainer["activity"]["current"]>(
    "idle",
    this.#reportSubscriberError,
  );
  readonly #capabilitySource = new StateSource<TrainerCapabilities | null>(
    null,
    this.#reportSubscriberError,
  );
  readonly #telemetrySource = new StateSource<TrainerTelemetry | null>(
    null,
    this.#reportSubscriberError,
  );
  readonly #controlResponseSource = new EventSource<ControlPointResponse>(
    this.#reportSubscriberError,
  );
  readonly #machineStatusSource = new EventSource<Uint8Array>(this.#reportSubscriberError);
  readonly #machineStatusEventSource = new EventSource<MachineStatus>(this.#reportSubscriberError);

  readonly connection = this.#connectionSource.asReadonly();
  readonly control = this.#controlSource.asReadonly();
  readonly activity = this.#activitySource.asReadonly();
  readonly capabilities = this.#capabilitySource.asReadonly();
  readonly telemetry = this.#telemetrySource.asReadonly();
  readonly controlResponses = this.#controlResponseSource.asReadonly();
  readonly machineStatus = this.#machineStatusSource.asReadonly();
  readonly machineStatusEvents = this.#machineStatusEventSource.asReadonly();
  readonly errors = this.#errorSource.asReadonly();

  #queue: ControlPointQueue | undefined;
  readonly #subscriptions: Unsubscribe[] = [];
  #connectPromise: Promise<TrainerCapabilities> | undefined;
  #disconnectPromise: Promise<void> | undefined;
  readonly #options: Required<TrainerOptions>;

  constructor(
    private readonly transport: FtmsTransport,
    options: TrainerOptions = {},
  ) {
    this.#options = {
      commandTimeoutMs: options.commandTimeoutMs ?? 4_000,
      autoStartTelemetry: options.autoStartTelemetry ?? true,
      strictProtocol: options.strictProtocol ?? true,
      resistanceControlFormat: options.resistanceControlFormat ?? "sint16",
    };
  }

  get deviceName(): string | undefined {
    return this.transport.deviceName;
  }

  async connect(): Promise<TrainerCapabilities> {
    if (this.#connectPromise) return this.#connectPromise;
    const operation = this.#connectAfterDisconnect();
    this.#connectPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.#connectPromise === operation) this.#connectPromise = undefined;
    }
  }

  async #connectAfterDisconnect(): Promise<TrainerCapabilities> {
    if (this.#disconnectPromise) await this.#disconnectPromise;
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
        this.#queue.errors.subscribe((error) => this.#errorSource.emit(error)),
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
            const bytes = new Uint8Array(
              value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
            );
            this.#machineStatusSource.emit(bytes);
            try {
              const status = parseMachineStatus(value);
              this.#machineStatusEventSource.emit(status);
              this.#applyMachineStatus(status);
            } catch (error) {
              this.#errorSource.emit(
                normalizeFtmsError(error, "Parsing Fitness Machine Status failed."),
              );
            }
          }),
        );
      } catch (error) {
        const normalized = normalizeFtmsError(
          error,
          "Fitness Machine Status notifications are unavailable.",
          FTMS_ERROR_CODE.transportFailure,
        );
        if (this.#options.strictProtocol) throw normalized;
        this.#errorSource.emit(normalized);
      }

      this.#connectionSource.set("ready");
      return capabilities;
    } catch (error) {
      const normalized = normalizeFtmsError(
        error,
        "Connecting to the FTMS trainer failed.",
        FTMS_ERROR_CODE.transportFailure,
      );
      this.#connectionSource.set("error");
      this.#errorSource.emit(normalized);
      try {
        await this.#cleanup(true);
      } catch (cleanupError) {
        this.#errorSource.emit(
          normalizeFtmsError(cleanupError, "Cleaning up a failed connection failed."),
        );
      }
      throw normalized;
    }
  }

  async disconnect(): Promise<void> {
    if (this.#disconnectPromise) return this.#disconnectPromise;
    const operation = this.#disconnectAfterConnect();
    this.#disconnectPromise = operation;
    try {
      await operation;
    } finally {
      if (this.#disconnectPromise === operation) this.#disconnectPromise = undefined;
    }
  }

  async #disconnectAfterConnect(): Promise<void> {
    if (this.#connectPromise) {
      try {
        await this.#connectPromise;
      } catch {
        // Failed connect() already performs cleanup; disconnect remains idempotent.
      }
    }
    try {
      await this.#cleanup(true);
    } catch (error) {
      const normalized = normalizeFtmsError(
        error,
        "Disconnecting from the FTMS trainer failed.",
        FTMS_ERROR_CODE.transportFailure,
      );
      this.#errorSource.emit(normalized);
      throw normalized;
    } finally {
      this.#connectionSource.setIfChanged("disconnected");
    }
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
    const response = await this.#command(pauseCommand(), {
      cancelQueuedKeys: ["setpoint"],
      priority: "safety",
    });
    this.#activitySource.set("paused");
    return response;
  }

  async stop(): Promise<ControlPointResponse> {
    this.#activitySource.set("stopping");
    try {
      const response = await this.#command(stopCommand(), {
        cancelQueuedKeys: ["setpoint"],
        priority: "safety",
      });
      this.#activitySource.set("idle");
      return response;
    } catch (error) {
      this.#activitySource.set("idle");
      this.#errorSource.emit(error instanceof Error ? error : new FtmsError(String(error)));
      throw error;
    }
  }

  async reset(): Promise<ControlPointResponse> {
    const response = await this.#command(resetCommand(), {
      cancelQueuedKeys: ["setpoint"],
      priority: "safety",
    });
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
    return this.#command(targetPowerCommand(watts), { coalesceKey: "setpoint" });
  }

  async setResistanceLevel(level: number): Promise<ControlPointResponse> {
    const capabilities = this.#requireCapabilities();
    if (!capabilities.supportsResistanceTarget) {
      throw new FtmsCapabilityError("This trainer does not advertise resistance target control.");
    }
    this.#assertRange(level, capabilities.resistanceRange, "Resistance level");
    return this.#command(targetResistanceCommand(level, this.#options.resistanceControlFormat), {
      coalesceKey: "setpoint",
    });
  }

  async setSimulation(parameters: SimulationParameters): Promise<ControlPointResponse> {
    if (!this.#requireCapabilities().supportsSimulation) {
      throw new FtmsCapabilityError(
        "This trainer does not advertise indoor bike simulation control.",
      );
    }
    return this.#command(simulationCommand(parameters), { coalesceKey: "setpoint" });
  }

  async #command(
    command: Uint8Array,
    options: ControlPointExecutionOptions = {},
  ): Promise<ControlPointResponse> {
    if (!this.transport.isConnected || !this.#queue) {
      throw new FtmsStateError(
        "Connect to a trainer before sending control commands.",
        FTMS_ERROR_CODE.notConnected,
      );
    }
    const response = await this.#queue.execute(command, options);
    if (response.resultCode !== CONTROL_RESULT.success) {
      const label =
        RESULT_LABELS[response.resultCode] ?? `result 0x${response.resultCode.toString(16)}`;
      throw new FtmsControlError(
        `FTMS command 0x${response.requestOpcode.toString(16)} failed: ${label}.`,
        response,
      );
    }
    return response;
  }

  #requireCapabilities(): TrainerCapabilities {
    if (!this.#capabilitySource.current) {
      throw new FtmsStateError(
        "Trainer capabilities are unavailable before connect().",
        FTMS_ERROR_CODE.notConnected,
      );
    }
    return this.#capabilitySource.current;
  }

  #assertRange(value: number, range: TrainerCapabilities["powerRange"], label: string): void {
    if (!Number.isFinite(value)) {
      throw new FtmsRangeError(`${label} must be a finite number.`);
    }
    if (range && (value < range.minimum || value > range.maximum)) {
      throw new FtmsRangeError(
        `${label} ${value} is outside the trainer's range ${range.minimum}–${range.maximum}.`,
      );
    }
    if (range?.increment && range.increment > 0) {
      const steps = (value - range.minimum) / range.increment;
      if (Math.abs(steps - Math.round(steps)) > 1e-9) {
        throw new FtmsRangeError(
          `${label} ${value} does not align with the trainer's ${range.increment} increment.`,
        );
      }
    }
  }

  async #readOptionalRange(
    uuid: number,
    parse: (view: DataView) => NonNullable<TrainerCapabilities["powerRange"]>,
  ): Promise<NonNullable<TrainerCapabilities["powerRange"]> | undefined> {
    try {
      return parse(await this.transport.read(uuid));
    } catch (error) {
      const normalized = normalizeFtmsError(
        error,
        `Reading advertised FTMS range 0x${uuid.toString(16)} failed.`,
        FTMS_ERROR_CODE.transportFailure,
      );
      if (this.#options.strictProtocol) throw normalized;
      this.#errorSource.emit(normalized);
      return undefined;
    }
  }

  #applyMachineStatus(status: MachineStatus): void {
    switch (status.kind) {
      case "reset":
        this.#controlSource.setIfChanged("unavailable");
        this.#activitySource.setIfChanged("idle");
        break;
      case "stopped-or-paused-by-user":
        this.#activitySource.setIfChanged(status.parameters[0] === 0x02 ? "paused" : "idle");
        break;
      case "stopped-by-safety-key":
        this.#activitySource.setIfChanged("idle");
        break;
      case "started-or-resumed-by-user":
        this.#activitySource.setIfChanged("running");
        break;
      case "control-permission-lost":
        this.#controlSource.setIfChanged("revoked");
        this.#activitySource.setIfChanged("idle");
        break;
      case "target-speed-changed":
      case "target-inclination-changed":
      case "target-resistance-changed":
      case "target-power-changed":
      case "target-heart-rate-changed":
      case "target-energy-changed":
      case "target-steps-changed":
      case "target-strides-changed":
      case "target-distance-changed":
      case "target-training-time-changed":
      case "target-time-two-heart-rate-zones-changed":
      case "target-time-three-heart-rate-zones-changed":
      case "target-time-five-heart-rate-zones-changed":
      case "simulation-parameters-changed":
      case "wheel-circumference-changed":
      case "spin-down-status":
      case "unknown":
        break;
    }
  }

  #handleDisconnect(reason: string): void {
    this.#queue?.close(reason);
    this.#queue = undefined;
    this.#unsubscribeAll();
    this.#capabilitySource.set(null);
    this.#telemetrySource.set(null);
    this.#controlSource.set("unavailable");
    this.#activitySource.set("idle");
    this.#connectionSource.set("disconnected");
  }

  async #cleanup(disconnectTransport: boolean): Promise<void> {
    this.#queue?.close();
    this.#queue = undefined;
    this.#unsubscribeAll();
    this.#capabilitySource.set(null);
    this.#telemetrySource.set(null);
    this.#controlSource.setIfChanged("unavailable");
    this.#activitySource.setIfChanged("idle");
    if (disconnectTransport && this.transport.isConnected) await this.transport.disconnect();
  }

  #unsubscribeAll(): void {
    for (const unsubscribe of this.#subscriptions.splice(0)) {
      try {
        unsubscribe();
      } catch (error) {
        this.#errorSource.emit(normalizeFtmsError(error, "Unsubscribing from FTMS failed."));
      }
    }
  }
}
