/**
 * Any value that can appear in execution data.
 * @experimental This type is experimental and may change in future releases.
 */
export type JsonValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | Date
  | Buffer
  | Uint8Array
  | RegExp
  | Map<string, JsonValue>
  | Set<JsonValue>
  | JsonValue[]
  | { [key: string]: JsonValue };

/** @experimental This type is experimental and may change in future releases. */
export type ExecutionInput = JsonValue;

/** @experimental This type is experimental and may change in future releases. */
export type ExecutionOutput = JsonValue;

/** @experimental This type is experimental and may change in future releases. */
export type OperationResult = JsonValue;

/**
 * Per-operation override for controlling inclusion and result transformation.
 * @experimental This interface is experimental and may change in future releases.
 */
export interface OperationOverride {
  operationName: string;
  exclude?: boolean;
  /**
   * Include and transform the operation's result. Omitted by default.
   *
   * ⚠️ The value passed to this function is the operation's **checkpointed,
   * serialized** result — JSON-parsed when it is valid JSON, otherwise the raw
   * string. The plugin does NOT run your SDK `Serdes.deserialize`. If the
   * operation uses a custom Serdes (non-JSON format, encryption, or a
   * filesystem/overflow Serdes that checkpoints only a pointer/filepath), this
   * function receives that serialized form or pointer — not the original
   * deserialized value. Only enable operation results for operations that use
   * the default JSON serialization, or whose serialized form your transform
   * can handle.
   */
  result?: (result: OperationResult) => OperationResult;
}

/**
 * Controls what data is included in emitted records.
 *
 * @experimental This interface is experimental and may change in future releases.
 */
export interface ContentConfig {
  input?: boolean | ((input: ExecutionInput) => ExecutionInput);
  output?: boolean | ((output: ExecutionOutput) => ExecutionOutput);
  operations?: {
    /**
     * Per-operation overrides, matched by `operationName`. If multiple entries
     * (or multiple operations) share a name, the last matching entry wins.
     */
    overrides?: OperationOverride[];
    includeErrors?: boolean;
  };
}

/**
 * Interface for exporting workflow insight records to a destination.
 * @experimental This interface is experimental and may change in future releases.
 */
export interface InsightExporter {
  export(record: WorkflowInsightRecord): Promise<void>;
  flush?(): Promise<void>;
  maxRecordSizeBytes?: number;
}

/**
 * Configuration for the Workflow Insight plugin.
 * @experimental This interface is experimental and may change in future releases.
 */
export interface WorkflowInsightConfig {
  exporters?: InsightExporter[];

  /**
   * Sampling rate: 0.0–1.0. When set, only a fraction of executions emit records.
   * The decision is per-execution (all-or-nothing).
   *
   * @experimental **Not yet implemented.** This field is reserved for a future release.
   * Setting it currently has no effect.
   */
  samplingRate?: number;

  /**
   * Controls when records are emitted.
   *
   * - `"on-change"`: emit on every operation status change and at execution
   *   end, including while the execution is still in flight (`RUNNING`).
   *   Highest overhead; gives real-time visibility into running executions.
   * - `"on-complete"` (default): emit a single record when the execution
   *   reaches a terminal status (`SUCCEEDED` or `FAILED`). No emissions on
   *   intermediate waits/suspends.
   * - `"on-failure"`: emit a single record only when the execution reaches a
   *   terminal `FAILED` status. Successful executions emit nothing. Lowest
   *   overhead; useful for error-focused alerting and triage.
   */
  emitMode?: "on-complete" | "on-change" | "on-failure";

  /**
   * Control what data is included in records (input/output transforms,
   * operation overrides, error inclusion).
   *
   * @experimental This field is experimental and may change in future releases.
   */
  content?: ContentConfig;
}

/**
 * A single operation within an execution (step, wait, invoke, callback, or context).
 * @experimental This interface is experimental and may change in future releases.
 */
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
  attempt?: number;
  error?: {
    name: string;
    message: string;
  };
  /**
   * The operation's result. Omitted by default; included only when a matching
   * `content.operations.overrides` entry supplies a `result` transform.
   */
  result?: OperationResult;
}

/**
 * How an exporter renders operations in the emitted record:
 * - `"array"`: the canonical `operations` array (lossless; default).
 * - `"by-name"`: replace it with the `operationsByName` map (name-keyed summary).
 * - `"both"`: include the `operations` array and the `operationsByName` map.
 *
 * @experimental This type is experimental and may change in future releases.
 */
export type OperationsFormat = "array" | "by-name" | "both";

/**
 * A per-operation-name summary emitted (as an `operationsByName` map) by
 * point-access exporters (CloudWatch Logs, DynamoDB) to make name-based queries
 * ergonomic. The canonical `operations` array remains the lossless source of
 * truth; see `docs/operations-shape.md`.
 *
 * Metric fields aggregate across ALL occurrences of the name; `type`, `subType`,
 * and `status` reflect the most recently seen occurrence. `result` and `error`
 * are included only when the name occurs exactly ONCE in the execution — for a
 * repeated name there is no single representative value, so both are omitted.
 *
 * @experimental This interface is experimental and may change in future releases.
 */
export interface OperationSummary {
  type: string;
  subType?: string;
  /** Number of occurrences of this operation name in the execution. */
  count: number;
  /** Min/max/total duration across occurrences that have a duration. */
  minDurationMs?: number;
  maxDurationMs?: number;
  totalDurationMs?: number;
  /** How many occurrences ended in FAILED. */
  failedCount: number;
  /** Highest attempt number seen across occurrences. */
  maxAttempt?: number;
  /** Status of the most recently seen occurrence. */
  status: string;
  /** Result — only present when this name occurs exactly once (and opted results in). */
  result?: OperationResult;
  /** Error — only present when this name occurs exactly once (and it failed, errors included). */
  error?: {
    name: string;
    message: string;
  };
}

/**
 * The curated execution record emitted to destinations.
 * @experimental This interface is experimental and may change in future releases.
 */
export interface WorkflowInsightRecord {
  /** Fixed identifier to distinguish insight records from other log data. */
  recordType: "WorkflowInsight";
  schemaVersion: "1.0";
  emittedAt: string;
  executionArn: string;
  executionName?: string;
  functionName: string;
  functionQualifier: string;
  region: string;
  accountId: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  startTime: string;
  endTime?: string;
  durationMs?: number;
  input?: ExecutionInput;
  output?: ExecutionOutput;
  error?: {
    name: string;
    message: string;
  };
  operations: OperationRecord[];
  pluginVersion: string;
  sdkVersion: string;
}
