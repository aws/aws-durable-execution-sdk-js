/**
 * The fields of a lite SDK operation record that this package reads. The lite SDK's
 * OperationRecord is assignable to it. A timestamp is epoch seconds (number) or an ISO
 * 8601 string.
 */
export interface WireOperation {
  Id: string;
  ParentId?: string;
  Name?: string;
  Type: string;
  SubType?: string;
  Status: string;
  StartTimestamp?: number | string;
  EndTimestamp?: number | string;
  StepDetails?: { Attempt?: number; Error?: WireError };
  CallbackDetails?: { Error?: WireError };
  ChainedInvokeDetails?: { Error?: WireError };
  ContextDetails?: { Error?: WireError };
}

/** The wire ErrorObject. */
export interface WireError {
  ErrorType?: string;
  ErrorMessage?: string;
  ErrorData?: string;
}

/** An error in a record. */
export interface ErrorRecord {
  name: string;
  message: string;
}

/** One operation in a record. Results are never included. */
export interface OperationRecord {
  id: string;
  name?: string;
  type: string;
  subType?: string;
  parentId?: string;
  status: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  /** StepDetails.Attempt: the number of finished attempts. */
  attempt?: number;
  error?: ErrorRecord;
}

/**
 * The record that exporters receive. It has the JSON shape of
 * DurableExecutionTelemetryRecord in @aws/durable-execution-sdk-js-telemetry-exporter.
 */
export interface DurableExecutionTelemetryRecord {
  recordType: "DurableExecutionTelemetry";
  schemaVersion: "1.0";
  /** ISO 8601. Strictly increases within one invocation. */
  emittedAt: string;
  executionArn: string;
  executionName?: string;
  functionName: string;
  functionQualifier: string;
  region: string;
  accountId: string;
  /** A suspended or retrying execution is RUNNING. */
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  /** The start of the execution: the EXECUTION record's StartTimestamp. */
  startTime: string;
  /** Absent while RUNNING. */
  endTime?: string;
  /** Absent while RUNNING. */
  durationMs?: number;
  input?: unknown;
  /** The workflow result, for SUCCEEDED. */
  output?: unknown;
  /** The execution error, for FAILED. */
  error?: ErrorRecord;
  operations: OperationRecord[];
  /** Set when the plugin dropped data to fit the exporter's maxRecordBytes. */
  truncated?: boolean;
  droppedInput?: boolean;
  droppedOutput?: boolean;
  /** The number of operations dropped from the end of operations. */
  droppedOperations?: number;
}

/** A destination for records. */
export interface TelemetryExporter {
  /** Sends one record. A rejection loses the record. The plugin logs one warning. */
  export(record: DurableExecutionTelemetryRecord): Promise<void>;
  /**
   * The largest JSON size in bytes that export receives. The plugin drops data from
   * a larger record first. Absent: no limit.
   */
  maxRecordBytes?: number;
}

/**
 * The client interface of the built-in exporters. send POSTs one signed request and
 * returns the parsed JSON response. It rejects with an Error that has name, status,
 * message and requestId.
 */
export interface AwsClient {
  send(request: {
    /** Default "/". */
    path?: string;
    headers?: Record<string, string>;
    /** The JSON request body. */
    body?: string;
  }): Promise<unknown>;
}

export interface TelemetryPluginConfig {
  exporters: readonly TelemetryExporter[];
  /** Default "on-complete". */
  emitMode?: "on-complete" | "on-failure" | "on-change";
  /** Default "top-level": operations without a ParentId. Unnamed operations are never included. */
  operations?: "top-level" | "all" | "none";
  /** Default true. */
  includeInput?: boolean;
  /** Default true. */
  includeOutput?: boolean;
  /** The fraction of executions that emit records, from 0 to 1. Default 1. */
  samplingRate?: number;
  /** The longest time onInvocationEnd waits for the exports. Default 3000. */
  exportTimeoutMs?: number;
}

/** The argument of the factory: the fields of the lite SDK's PluginInvocationInfo that the plugin reads. */
export interface TelemetryInvocationInfo {
  arn: string;
  input: unknown;
  operations: readonly WireOperation[];
}

/** The plugin object for one invocation. It is a lite SDK DurablePlugin. */
export interface TelemetryPlugin {
  onOperationChange?(change: { operations: readonly WireOperation[] }): void;
  onInvocationEnd(end: {
    status: "SUCCEEDED" | "FAILED" | "PENDING" | "RETRYING";
    result: unknown;
    error: unknown;
    operations: readonly WireOperation[];
  }): Promise<void>;
}

/**
 * Returns a plugin factory for withDurableExecution's plugins. The factory returns
 * undefined for an execution that sampling leaves out.
 */
export function createTelemetryPlugin(
  config: TelemetryPluginConfig,
): (info: TelemetryInvocationInfo) => TelemetryPlugin | undefined;

/**
 * Builds a record from wire records. The plugin calls it for every record. It is
 * exported for tests and custom exporters.
 */
export function buildRecord(args: {
  arn: string;
  /** A lite invocation status, or "RUNNING". PENDING and RETRYING become RUNNING. */
  status: "SUCCEEDED" | "FAILED" | "PENDING" | "RETRYING" | "RUNNING";
  operations?: readonly WireOperation[];
  input?: unknown;
  output?: unknown;
  /** The execution's ErrorObject. */
  error?: WireError;
  /** Default: the EXECUTION record's StartTimestamp, or the current time. */
  startTime?: Date;
  /** Default: the current time. Also the end time of a SUCCEEDED or FAILED record. */
  emittedAt?: Date;
  /** Default "top-level". */
  operationsMode?: "top-level" | "all" | "none";
}): DurableExecutionTelemetryRecord;
