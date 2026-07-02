import type {
  DurableExecutionInvocationOutput,
  DurableInstrumentationPlugin,
  InvocationInfo,
  InvocationEndInfo,
  OperationChangeInfo,
  OperationInfo,
  PluginInvocationStatus,
} from "@aws/durable-execution-sdk-js";
import type {
  WorkflowInsightConfig,
  WorkflowInsightRecord,
  OperationRecord,
  OperationOverride,
  OperationResult,
  JsonValue,
  InsightExporter,
} from "./types";
import { withOperationsByName } from "./operations-index";

export type {
  InsightExporter,
  WorkflowInsightConfig,
  WorkflowInsightRecord,
  OperationRecord,
  OperationSummary,
  OperationsFormat,
  ContentConfig,
  OperationOverride,
} from "./types";

export {
  buildOperationsByName,
  withOperationsByName,
  applyOperationsFormat,
} from "./operations-index";

export { S3Exporter } from "./exporters/s3-exporter";
export type { S3ExporterConfig } from "./exporters/s3-exporter";

export { DynamoDBExporter } from "./exporters/dynamodb-exporter";
export type { DynamoDBExporterConfig } from "./exporters/dynamodb-exporter";

export { AuroraExporter } from "./exporters/aurora-exporter";
export type { AuroraExporterConfig } from "./exporters/aurora-exporter";

export { CloudWatchLogsExporter } from "./exporters/cloudwatch-logs-exporter";
export type { CloudWatchLogsExporterConfig } from "./exporters/cloudwatch-logs-exporter";

export { OTelExporter } from "./exporters/otel-exporter";
export type { OTelExporterConfig } from "./exporters/otel-exporter";

export { FirehoseExporter } from "./exporters/firehose-exporter";
export type { FirehoseExporterConfig } from "./exporters/firehose-exporter";

export { EventBridgeExporter } from "./exporters/eventbridge-exporter";
export type { EventBridgeExporterConfig } from "./exporters/eventbridge-exporter";

export { RedshiftExporter } from "./exporters/redshift-exporter";
export type { RedshiftExporterConfig } from "./exporters/redshift-exporter";

export { OpenSearchExporter } from "./exporters/opensearch-exporter";
export type { OpenSearchExporterConfig } from "./exporters/opensearch-exporter";

export { SQSExporter } from "./exporters/sqs-exporter";
export type { SQSExporterConfig } from "./exporters/sqs-exporter";

export { TimestreamExporter } from "./exporters/timestream-exporter";
export type { TimestreamExporterConfig } from "./exporters/timestream-exporter";

export { HttpExporter } from "./exporters/http-exporter";
export type { HttpExporterConfig } from "./exporters/http-exporter";

export { FileExporter } from "./exporters/file-exporter";
export type { FileExporterConfig } from "./exporters/file-exporter";

// --- ARN Parsing ---

interface ParsedArn {
  functionName: string;
  qualifier: string;
  region: string;
  accountId: string;
  executionName: string;
  invocationId: string;
}

function parseExecutionArn(executionArn: string): ParsedArn {
  // Format: arn:<partition>:lambda:<region>:<accountId>:function:<functionName>:<qualifier>/durable-execution/<executionName>/<invocationId>
  const parts = executionArn.split(":");
  const lastPart = parts[7] ?? "";
  const segments = lastPart.split("/");
  return {
    region: parts[3] ?? "",
    accountId: parts[4] ?? "",
    functionName: parts[6] ?? "",
    qualifier: segments[0] ?? "",
    executionName: segments[2] ?? "",
    invocationId: segments[3] ?? "",
  };
}

// --- Status Mapping ---

const STATUS_MAP: Record<string, WorkflowInsightRecord["status"]> = {
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  // A durable execution suspends (no compute) while waiting on a timer or an
  // external event/callback. The runtime reports this as PENDING, but from the
  // execution's point of view it is still in flight, so we surface it as
  // RUNNING. RETRYING (runtime will auto-retry) is likewise still in flight.
  PENDING: "RUNNING",
  RETRYING: "RUNNING",
};

function mapStatus(
  status: PluginInvocationStatus,
): WorkflowInsightRecord["status"] {
  return STATUS_MAP[status] ?? "RUNNING";
}

// --- Operation Records ---

/**
 * Operation timestamps may arrive as Date objects (local test runner) or as
 * epoch milliseconds / ISO strings (real Lambda durable runtime, after
 * checkpoint serialization). Normalize defensively so record building never
 * throws on an unexpected shape.
 */
function toEpochMs(ts: unknown): number | undefined {
  if (ts == null) return undefined;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === "number") return Number.isFinite(ts) ? ts : undefined;
  if (typeof ts === "string") {
    const ms = new Date(ts).getTime();
    return Number.isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

function toIsoString(ts: unknown): string | undefined {
  const ms = toEpochMs(ts);
  return ms === undefined ? undefined : new Date(ms).toISOString();
}

function toOperationRecord(op: OperationInfo): OperationRecord {
  const startMs = toEpochMs(op.startTimestamp);
  const endMs = toEpochMs(op.endTimestamp);
  const durationMs =
    startMs !== undefined && endMs !== undefined ? endMs - startMs : undefined;

  return {
    id: op.id,
    name: op.name,
    type: op.type,
    subType: op.subType,
    parentId: op.parentId,
    status: op.status ?? "UNKNOWN",
    startTime: toIsoString(op.startTimestamp),
    endTime: toIsoString(op.endTimestamp),
    durationMs,
    attempt: op.attempt,
    error: op.error
      ? { name: op.error.name, message: op.error.message }
      : undefined,
  };
}

/**
 * Options controlling how operation records are filtered/enriched, derived from
 * `content.operations`.
 */
interface OperationContentOptions {
  /** Overrides keyed by `operationName`. */
  overridesByName: Map<string, OperationOverride>;
  /** Whether to include per-operation error details. */
  includeErrors: boolean;
}

/**
 * Applies a user-supplied result transform to an operation's raw (serialized)
 * result. The checkpointed result is a JSON string; we parse it before handing
 * it to the transform, falling back to the raw string if it isn't valid JSON.
 *
 * User transforms are untrusted code: a throwing transform must never break the
 * execution or leak the raw result, so on error we omit the field.
 */
function applyResultOverride(
  transform: (result: OperationResult) => OperationResult,
  rawResult: string | undefined,
): OperationResult | undefined {
  if (rawResult === undefined) return undefined;
  let parsed: OperationResult;
  try {
    parsed = JSON.parse(rawResult) as OperationResult;
  } catch {
    parsed = rawResult;
  }
  try {
    return transform(parsed);
  } catch {
    return undefined;
  }
}

/**
 * Resolves a `content.input`/`content.output` setting against a value.
 * - `false` → omit (undefined)
 * - function → transformed value (omit on throw, so a failing redactor never
 *   leaks the raw value)
 * - `true`/`undefined` → include as-is
 */
function applyDataContent(
  value: unknown,
  setting: boolean | ((value: JsonValue) => JsonValue) | undefined,
): JsonValue | undefined {
  if (setting === false) return undefined;
  if (value === undefined) return undefined;
  if (typeof setting === "function") {
    try {
      return setting(value as JsonValue);
    } catch {
      return undefined;
    }
  }
  return value as JsonValue;
}

function buildOperationRecords(
  operations: Record<string, OperationInfo>,
  opts: OperationContentOptions,
): OperationRecord[] {
  const records: OperationRecord[] = [];
  for (const op of Object.values(operations)) {
    // Unnamed operations are excluded by default (can't be targeted or keyed).
    if (!op.name) continue;

    const override = opts.overridesByName.get(op.name);
    if (override?.exclude) continue;

    const record = toOperationRecord(op);

    if (!opts.includeErrors) {
      record.error = undefined;
    }

    // Results are omitted unless an override explicitly opts in via a transform.
    if (override?.result) {
      record.result = applyResultOverride(override.result, op.result);
    }

    records.push(record);
  }
  return records;
}

// --- CloudWatch Logs Exporter ---

/**
 * Exports workflow insight records to CloudWatch Logs via console.log.
 * Since Lambda sends stdout to the function's CloudWatch log group,
 * this requires no additional IAM permissions or configuration.
 * @experimental This class is experimental and may change in future releases.
 */
export class LambdaLogExporter implements InsightExporter {
  async export(record: WorkflowInsightRecord): Promise<void> {
    console.log(JSON.stringify(withOperationsByName(record)));
  }
}

// --- Export Scheduling ---

/**
 * Serializes record exports so that, at most, one export runs at a time.
 *
 * Each {@link WorkflowInsightRecord} is a complete snapshot of the execution,
 * so a newer record fully supersedes any record still waiting to be exported.
 * While an export is in flight, additional updates are coalesced into a single
 * "pending" slot — intermediate records are dropped because the latest one
 * already contains all of their information. This prevents overlapping
 * `export()` calls when updates arrive faster than the exporter can keep up.
 */
class ExportScheduler {
  private inFlight: Promise<void> | undefined;
  private pending: WorkflowInsightRecord | undefined;

  constructor(private readonly exporters: InsightExporter[]) {}

  /**
   * Queue the latest record for export. If an export is already running, the
   * record is held in the pending slot (replacing any earlier pending record)
   * and exported once the in-flight export completes.
   */
  schedule(record: WorkflowInsightRecord): void {
    this.pending = record;
    if (this.inFlight === undefined) {
      this.inFlight = this.pump();
    }
  }

  /**
   * Wait for any in-flight and pending exports to complete. Safe to call when
   * idle. Used before the invocation returns to guarantee the final record is
   * delivered (exports are otherwise fire-and-forget).
   */
  async drain(): Promise<void> {
    while (this.inFlight !== undefined) {
      await this.inFlight;
    }
  }

  private async pump(): Promise<void> {
    try {
      // Drain the pending slot until no newer record has arrived. The check and
      // the reset below run synchronously between awaits, so no update is lost.
      while (this.pending !== undefined) {
        const record = this.pending;
        this.pending = undefined;
        // allSettled so one failing/slow exporter never blocks or fails the others,
        // and an export error never propagates into the execution.
        await Promise.allSettled(
          this.exporters.map((exporter) => exporter.export(record)),
        );
      }
    } finally {
      this.inFlight = undefined;
    }
  }
}

/** Flush all exporters that support it, ignoring individual failures. */
async function flushAll(exporters: InsightExporter[]): Promise<void> {
  await Promise.allSettled(
    exporters.map((exporter) => exporter.flush?.() ?? Promise.resolve()),
  );
}

// --- Plugin Factory ---

/**
 * Creates a Workflow Insight plugin that listens to execution lifecycle events.
 * @experimental This function is experimental and may change in future releases.
 */
export function workflowInsight(
  config: WorkflowInsightConfig,
): DurableInstrumentationPlugin {
  // Warn about unimplemented config options
  if (config.samplingRate !== undefined) {
    console.warn(
      "[workflow-insight] samplingRate is not yet implemented and has no effect.",
    );
  }

  const content = config.content;
  const includeErrors = content?.operations?.includeErrors ?? true;
  const overridesByName = new Map<string, OperationOverride>();
  for (const override of content?.operations?.overrides ?? []) {
    overridesByName.set(override.operationName, override);
  }
  const opContentOptions: OperationContentOptions = {
    overridesByName,
    includeErrors,
  };

  const exporters =
    config.exporters && config.exporters.length > 0
      ? config.exporters
      : [new LambdaLogExporter()];
  const emitMode = config.emitMode ?? "on-complete";
  const scheduler = new ExportScheduler(exporters);

  // Per-execution state, keyed by executionArn. Prevents warm-container bleed
  // between executions and handles resume correctly.
  interface ExecutionState {
    startTime: Date;
    parsedArn: ParsedArn;
    cachedInput: unknown;
  }
  const execState = new Map<string, ExecutionState>();

  function getState(executionArn: string): ExecutionState {
    let state = execState.get(executionArn);
    if (!state) {
      state = {
        startTime: new Date(),
        parsedArn: parseExecutionArn(executionArn),
        cachedInput: undefined,
      };
      execState.set(executionArn, state);
    }
    return state;
  }

  const buildRecord = (args: {
    executionArn: string;
    status: WorkflowInsightRecord["status"];
    operations: OperationRecord[];
    endTime?: Date;
    input?: unknown;
    output?: unknown;
    error?: Error;
  }): WorkflowInsightRecord => {
    const state = getState(args.executionArn);
    const arn = state.parsedArn;
    const startTime = state.startTime;
    const durationMs = args.endTime
      ? args.endTime.getTime() - startTime.getTime()
      : undefined;

    return {
      recordType: "WorkflowInsight" as const,
      schemaVersion: "1.0",
      emittedAt: new Date().toISOString(),
      executionArn: args.executionArn,
      executionName: arn.executionName || undefined,
      functionName: arn.functionName,
      functionQualifier: arn.qualifier,
      region: arn.region,
      accountId: arn.accountId,
      status: args.status,
      startTime: startTime.toISOString(),
      endTime: args.endTime?.toISOString(),
      durationMs,
      input: applyDataContent(args.input, content?.input),
      output: applyDataContent(args.output, content?.output),
      error: args.error
        ? { name: args.error.name, message: args.error.message }
        : undefined,
      operations: args.operations,
    };
  };

  return {
    async onInvocationStart(info: InvocationInfo): Promise<void> {
      const state = getState(info.executionArn);
      if (info.isFirstInvocation) {
        state.startTime = new Date();
      }
      state.cachedInput = info.executionInput;

      if (emitMode === "on-change") {
        scheduler.schedule(
          buildRecord({
            executionArn: info.executionArn,
            status: "RUNNING",
            operations: buildOperationRecords(
              info.operations,
              opContentOptions,
            ),
            input: info.executionInput,
          }),
        );
      }
    },

    // wrapInvocation is the only hook the SDK awaits. We use it to drain the
    // export queue before the invocation returns, guaranteeing the final
    // record (scheduled by onInvocationEnd, which runs inside fn) is delivered.
    // The drain runs in `finally` so it also covers the throwing/retry paths.
    async wrapInvocation(
      _info: InvocationInfo,
      fn: () => Promise<DurableExecutionInvocationOutput>,
    ): Promise<DurableExecutionInvocationOutput> {
      try {
        return await fn();
      } finally {
        await scheduler.drain();
        await flushAll(exporters);
      }
    },

    async onInvocationEnd(info: InvocationEndInfo): Promise<void> {
      const status = mapStatus(info.status);
      const isTerminal = status === "SUCCEEDED" || status === "FAILED";
      const isFailure = status === "FAILED";

      // Decide whether this status update should produce a record.
      // - on-change:   emit on every update (terminal or not)
      // - on-complete: emit only on terminal SUCCEEDED/FAILED
      // - on-failure:  emit only on terminal FAILED
      const shouldEmit =
        emitMode === "on-change"
          ? true
          : emitMode === "on-failure"
            ? isFailure
            : isTerminal;

      if (shouldEmit) {
        scheduler.schedule(
          buildRecord({
            executionArn: info.executionArn,
            status,
            operations: buildOperationRecords(
              info.operations,
              opContentOptions,
            ),
            endTime: new Date(),
            input: info.executionInput,
            output: info.executionResult,
            error: info.executionError,
          }),
        );
      }

      // Only clear per-execution state once the execution is truly finished.
      // onInvocationEnd also fires on non-terminal suspends (PENDING/RETRYING);
      // clearing state there would lose the original startTime and cachedInput
      // across resumes and corrupt duration computation.
      if (isTerminal) {
        execState.delete(info.executionArn);
      }
    },

    async onOperationChange(info: OperationChangeInfo): Promise<void> {
      if (emitMode !== "on-change") {
        return;
      }
      const state = getState(info.executionArn);
      scheduler.schedule(
        buildRecord({
          executionArn: info.executionArn,
          status: "RUNNING",
          operations: buildOperationRecords(info.operations, opContentOptions),
          input: state.cachedInput,
        }),
      );
    },
  };
}
