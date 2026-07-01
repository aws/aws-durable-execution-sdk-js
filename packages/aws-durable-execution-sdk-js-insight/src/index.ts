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
  InsightExporter,
} from "./types";

export type {
  InsightExporter,
  WorkflowInsightConfig,
  WorkflowInsightRecord,
  OperationRecord,
  ContentConfig,
  OperationOverride,
} from "./types";

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

function buildOperationRecords(
  operations: Record<string, OperationInfo>,
): OperationRecord[] {
  return Object.values(operations)
    .filter((op) => op.name)
    .map(toOperationRecord);
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
    console.log(JSON.stringify(record));
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

const PLUGIN_VERSION = "0.1.0-alpha.0";
const SDK_VERSION = "2.0.0-alpha.1";

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
  if (config.content !== undefined) {
    console.warn(
      "[workflow-insight] content filtering is not yet implemented and has no effect.",
    );
  }

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
      input: args.input as WorkflowInsightRecord["input"],
      output: args.output as WorkflowInsightRecord["output"],
      error: args.error
        ? { name: args.error.name, message: args.error.message }
        : undefined,
      operations: args.operations,
      pluginVersion: PLUGIN_VERSION,
      sdkVersion: SDK_VERSION,
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
            operations: buildOperationRecords(info.operations),
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
            operations: buildOperationRecords(info.operations),
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
          operations: buildOperationRecords(info.operations),
          input: state.cachedInput,
        }),
      );
    },
  };
}
