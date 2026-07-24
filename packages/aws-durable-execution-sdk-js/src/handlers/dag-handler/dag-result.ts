import {
  AnyTaskHandle,
  DagCompletionReason,
  DagResult,
  DagSummary,
  SkipReason,
  TaskExecution,
  TaskHandle,
  TaskStatus,
} from "../../types/dag";
import { DagExecutionError } from "../../errors/dag-errors/dag-errors";
import { ErrorObject } from "@aws-sdk/client-lambda";
import { DurableOperationError } from "../../errors/durable-error/durable-error";
import { Serdes, SerdesContext } from "../../utils/serdes/serdes";
import {
  BatchResultImpl,
  createBatchResultSerdes,
  restoreBatchResult,
} from "../concurrent-execution-handler/batch-result";
import { ExecutionContext } from "../../types/core";

/**
 * Concrete {@link DagResult}. Computes counts once at construction and resolves
 * results by task name.
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class DagResultImpl implements DagResult {
  readonly results: ReadonlyMap<string, TaskExecution>;
  readonly successCount: number;
  readonly failureCount: number;
  readonly skippedCount: number;
  readonly totalCount: number;
  readonly completionReason: DagCompletionReason;

  constructor(
    results: Map<string, TaskExecution>,
    completionReason: DagCompletionReason,
    totalCount?: number,
  ) {
    this.results = results;
    this.completionReason = completionReason;
    let success = 0;
    let failure = 0;
    let skipped = 0;
    for (const exec of results.values()) {
      if (exec.status === "SUCCEEDED") {
        success++;
      } else if (exec.status === "FAILED") {
        failure++;
      } else if (exec.status === "SKIPPED") {
        skipped++;
      }
    }
    this.successCount = success;
    this.failureCount = failure;
    this.skippedCount = skipped;
    this.totalCount = totalCount ?? results.size;
  }

  getResult<TResult>(handle: TaskHandle<string, TResult>): TResult | undefined;
  getResult(name: string): unknown;
  getResult(handleOrName: string | AnyTaskHandle): unknown {
    const name =
      typeof handleOrName === "string" ? handleOrName : handleOrName._name;
    const exec = this.results.get(name);
    return exec && exec.status === "SUCCEEDED" ? exec.result : undefined;
  }

  getStatus(taskNameOrHandle: string | AnyTaskHandle): TaskStatus | undefined {
    const name =
      typeof taskNameOrHandle === "string"
        ? taskNameOrHandle
        : taskNameOrHandle._name;
    return this.results.get(name)?.status;
  }

  succeeded(): TaskExecution[] {
    return [...this.results.values()].filter((e) => e.status === "SUCCEEDED");
  }

  failed(): TaskExecution[] {
    return [...this.results.values()].filter((e) => e.status === "FAILED");
  }

  skipped(): TaskExecution[] {
    return [...this.results.values()].filter((e) => e.status === "SKIPPED");
  }

  throwIfError(): void {
    if (
      this.failureCount > 0 ||
      this.completionReason === "CUSTOM_COMPLETION_FAILED"
    ) {
      const firstError = [...this.results.values()].find(
        (e) => e.status === "FAILED",
      )?.error;
      throw new DagExecutionError(
        `DAG execution had ${this.failureCount} failed task(s)`,
        firstError,
      );
    }
  }
}

type SerializedResultKind = "plain" | "batch" | "dag";

interface SerializedTaskExecution {
  name: string;
  status: TaskStatus;
  skipReason?: SkipReason;
  resultKind?: SerializedResultKind;
  result?: unknown;
  error?: ErrorObject;
  startedAt?: string;
  completedAt?: string;
}

interface SerializedDagResult {
  tasks: SerializedTaskExecution[];
  completionReason: DagCompletionReason;
  totalCount: number;
}

const batchSerdes = createBatchResultSerdes<unknown>();

async function serializeDagResultObject(
  value: DagResult,
  context: SerdesContext,
): Promise<SerializedDagResult> {
  const tasks: SerializedTaskExecution[] = [];
  for (const exec of value.results.values()) {
    const s: SerializedTaskExecution = { name: exec.name, status: exec.status };
    if (exec.skipReason) {
      s.skipReason = exec.skipReason;
    }
    if (exec.startedAt) {
      s.startedAt = exec.startedAt.toISOString();
    }
    if (exec.completedAt) {
      s.completedAt = exec.completedAt.toISOString();
    }
    if (exec.status === "FAILED" && exec.error) {
      s.error = exec.error.toErrorObject();
    }
    if (exec.status === "SUCCEEDED") {
      const r = exec.result;
      if (r instanceof DagResultImpl) {
        s.resultKind = "dag";
        s.result = await serializeDagResultObject(r, context);
      } else if (r instanceof BatchResultImpl) {
        s.resultKind = "batch";
        const str = await batchSerdes.serialize(r, context);
        s.result = str ? JSON.parse(str) : undefined;
      } else {
        s.resultKind = "plain";
        s.result = r;
      }
    }
    tasks.push(s);
  }
  return {
    tasks,
    completionReason: value.completionReason,
    totalCount: value.totalCount,
  };
}

/**
 * Restores a deserialized (plain) DAG result — or an already-methoded
 * {@link DagResultImpl} — into a fully-methoded {@link DagResult}, recursively
 * restoring `batch`/`dag` task results by their `resultKind`.
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function restoreDagResult(data: unknown): DagResult {
  if (data instanceof DagResultImpl) {
    return data;
  }
  if (
    data &&
    typeof data === "object" &&
    "tasks" in data &&
    Array.isArray((data as SerializedDagResult).tasks)
  ) {
    const s = data as SerializedDagResult;
    const map = new Map<string, TaskExecution>();
    for (const t of s.tasks) {
      const exec: TaskExecution = { name: t.name, status: t.status };
      if (t.skipReason) {
        exec.skipReason = t.skipReason;
      }
      if (t.startedAt) {
        exec.startedAt = new Date(t.startedAt);
      }
      if (t.completedAt) {
        exec.completedAt = new Date(t.completedAt);
      }
      if (t.status === "FAILED" && t.error) {
        exec.error = DurableOperationError.fromErrorObject(t.error);
      }
      if (t.status === "SUCCEEDED") {
        if (t.resultKind === "batch") {
          exec.result = restoreBatchResult(t.result);
        } else if (t.resultKind === "dag") {
          exec.result = restoreDagResult(t.result);
        } else {
          exec.result = t.result;
        }
      }
      map.set(t.name, exec);
    }
    return new DagResultImpl(map, s.completionReason, s.totalCount);
  }
  return new DagResultImpl(new Map(), "ALL_COMPLETED", 0);
}

/**
 * Serdes for the aggregated {@link DagResult} container payload. Tags each
 * task's result with a `resultKind` discriminator so heterogeneous,
 * method-bearing results (`batch`/nested `dag`) survive the round-trip.
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function createDagResultSerdes(): Serdes<DagResult> {
  return {
    serialize: async (
      value: DagResult | undefined,
      context: SerdesContext,
    ): Promise<string | undefined> =>
      value
        ? JSON.stringify(await serializeDagResultObject(value, context))
        : undefined,
    deserialize: async (
      data: string | undefined,
    ): Promise<DagResult | undefined> =>
      data ? restoreDagResult(JSON.parse(data)) : undefined,
  };
}

/**
 * Default observability-only summary text for a DAG result.
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function defaultDagSummaryGenerator(result: DagResult): string {
  return (
    `${result.successCount}/${result.totalCount} succeeded, ` +
    `${result.failureCount} failed, ${result.skippedCount} skipped ` +
    `(${result.completionReason})`
  );
}

/**
 * Builds the SDK-owned {@link DagSummary} envelope for the large-payload
 * fallback. SDK-owned count/reason/started fields are authoritative; the
 * customer generator output is quarantined under `summary` (never read on
 * replay).
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function buildDagSummaryEnvelope(
  result: DagResult,
  generator: (result: DagResult) => string,
): DagSummary {
  const startedTaskNames: string[] = [];
  const terminalTaskNames: string[] = [];
  for (const [name, exec] of result.results) {
    if (exec.status === "STARTED") {
      startedTaskNames.push(name);
    } else {
      terminalTaskNames.push(name);
    }
  }
  let summary: string | undefined;
  try {
    summary = generator(result);
  } catch {
    summary = undefined;
  }
  return {
    type: "DagResult",
    totalCount: result.totalCount,
    successCount: result.successCount,
    failureCount: result.failureCount,
    skippedCount: result.skippedCount,
    completedCount:
      result.successCount + result.failureCount + result.skippedCount,
    completionReason: result.completionReason,
    startedTaskNames,
    terminalTaskNames,
    summary,
  };
}

/**
 * Reads and validates the checkpointed {@link DagSummary} envelope for a DAG
 * container. Returns `null` if missing or malformed (reconstruction then
 * derives from per-task checkpoints with an empty STARTED set — never hangs).
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function readDagSummaryEnvelope(
  executionContext: ExecutionContext,
  entityId: string | undefined,
): DagSummary | null {
  if (!entityId) {
    return null;
  }
  const stepData = executionContext.getStepData(entityId);
  const payload = stepData?.ContextDetails?.Result;
  if (!payload) {
    return null;
  }
  try {
    const parsed = JSON.parse(payload) as Partial<DagSummary>;
    const counts = [
      parsed.totalCount,
      parsed.successCount,
      parsed.failureCount,
      parsed.skippedCount,
      parsed.completedCount,
    ];
    if (
      parsed &&
      parsed.type === "DagResult" &&
      counts.every(
        (n) => typeof n === "number" && Number.isInteger(n) && n >= 0,
      ) &&
      Array.isArray(parsed.startedTaskNames)
    ) {
      return parsed as DagSummary;
    }
  } catch {
    // fall through to null
  }
  return null;
}
