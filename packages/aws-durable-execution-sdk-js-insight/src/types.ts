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
  result?: (result: OperationResult) => OperationResult;
}

/**
 * Controls what data is included in the emitted record.
 * @experimental This interface is experimental and may change in future releases.
 */
export interface ContentConfig {
  input?: boolean | ((input: ExecutionInput) => ExecutionInput);
  output?: boolean | ((output: ExecutionOutput) => ExecutionOutput);
  operations?: {
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
  samplingRate?: number;
  emitMode?: "finished-only" | "in-progress";
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
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "PENDING";
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
