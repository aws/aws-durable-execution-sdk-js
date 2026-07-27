import {
  AnyTaskHandle,
  DagCompletionReason,
  DagResult,
  DagResultEnvelope,
  SerializedDagTask,
  TaskExecution,
  TaskHandle,
  TaskStatus,
} from "../../types/dag";
import { ErrorObject } from "@aws-sdk/client-lambda";
import { DagExecutionError } from "../../errors/dag-errors/dag-errors";
import { DurableOperationError } from "../../errors/durable-error/durable-error";
import { Serdes, SerdesContext } from "../../utils/serdes/serdes";
import {
  BatchResultImpl,
  createBatchResultSerdes,
  restoreBatchResult,
} from "../concurrent-execution-handler/batch-result";
import { ExecutionContext } from "../../types/core";
import { CHECKPOINT_SIZE_LIMIT_BYTES } from "../../utils/constants/constants";

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
    authoritativeCounts?: {
      successCount: number;
      failureCount: number;
      skippedCount: number;
    },
  ) {
    this.results = results;
    this.completionReason = completionReason;
    if (authoritativeCounts) {
      // Offloaded replay: counts are sourced from the converged
      // DagResultEnvelope (authoritative), NOT recomputed from the
      // reconstructed results map — under early completion the two can
      // legitimately differ, and once terminalTaskNames was dropped the greedy
      // skip recompute may materialize a skip the live run left absent, so the
      // envelope counts remain the source of truth for the aggregate.
      this.successCount = authoritativeCounts.successCount;
      this.failureCount = authoritativeCounts.failureCount;
      this.skippedCount = authoritativeCounts.skippedCount;
    } else {
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
    }
    this.totalCount = totalCount ?? results.size;
  }

  getResult<TResult>(handle: TaskHandle<string, TResult>): TResult | undefined;
  getResult(name: string): unknown;
  getResult(handleOrName: string | AnyTaskHandle): unknown {
    const name =
      typeof handleOrName === "string" ? handleOrName : handleOrName.name;
    const exec = this.results.get(name);
    return exec && exec.status === "SUCCEEDED" ? exec.result : undefined;
  }

  getStatus(taskNameOrHandle: string | AnyTaskHandle): TaskStatus | undefined {
    const name =
      typeof taskNameOrHandle === "string"
        ? taskNameOrHandle
        : taskNameOrHandle.name;
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

const batchSerdes = createBatchResultSerdes<unknown>();

/** Task names currently in `status`, in registration (results-map) order. */
function taskNamesByStatus(result: DagResult, status: TaskStatus): string[] {
  const names: string[] = [];
  for (const exec of result.results.values()) {
    if (exec.status === status) {
      names.push(exec.name);
    }
  }
  return names;
}

/**
 * Builds the aggregate (task-less) portion of the {@link DagResultEnvelope} —
 * the fields shared, byte-for-byte, by the inline and the offloaded payload.
 * `failedTaskNames` starts as an array; the offload degradation ladder may
 * later null it. Field order matches the cross-language listing for console
 * readability (conformance compares parsed structures, not order).
 */
function buildEnvelopeAggregate(result: DagResult): DagResultEnvelope {
  return {
    type: "DagResult",
    totalCount: result.totalCount,
    successCount: result.successCount,
    failureCount: result.failureCount,
    skippedCount: result.skippedCount,
    completionReason: result.completionReason,
    startedTaskNames: taskNamesByStatus(result, "STARTED"),
    failedTaskNames: taskNamesByStatus(result, "FAILED"),
  };
}

/**
 * Serializes one {@link TaskExecution} into the canonical, explicit-null task
 * shape. Every field is ALWAYS present; unset values are `null`, never omitted
 * (envelope contract rule 1). `resultKind` is lowercase.
 */
async function serializeTask(
  exec: TaskExecution,
  context: SerdesContext,
): Promise<SerializedDagTask> {
  let resultKind: SerializedDagTask["resultKind"] = null;
  let result: unknown = null;
  if (exec.status === "SUCCEEDED") {
    const r = exec.result;
    if (r instanceof DagResultImpl) {
      resultKind = "dag";
      result = await serializeDagResultEnvelope(r, context);
    } else if (r instanceof BatchResultImpl) {
      resultKind = "batch";
      const str = await batchSerdes.serialize(r, context);
      result = str ? JSON.parse(str) : null;
    } else {
      resultKind = "plain";
      result = r ?? null;
    }
  }
  return {
    name: exec.name,
    status: exec.status,
    skipReason: exec.status === "SKIPPED" ? (exec.skipReason ?? null) : null,
    resultKind,
    result,
    error:
      exec.status === "FAILED" && exec.error
        ? canonicalTaskError(exec.error.toErrorObject())
        : null,
    startedAt: exec.startedAt ? exec.startedAt.toISOString() : null,
    completedAt: exec.completedAt ? exec.completedAt.toISOString() : null,
  };
}

/**
 * Normalizes an error object to the canonical cross-language shape: `ErrorType`,
 * `ErrorMessage` and `StackTrace` are ALWAYS present, `null` when unset (envelope
 * contract rule 1). Extra platform fields such as `ErrorData` are preserved.
 *
 * Needed because `toErrorObject()` leaves `StackTrace` and `ErrorData`
 * `undefined` when stack-trace capture is disabled, and `JSON.stringify` drops
 * undefined keys, which silently omitted them from the checkpointed envelope
 * where the other three SDKs emit explicit nulls.
 */
function canonicalTaskError(error: ErrorObject): ErrorObject {
  return {
    ...error,
    ErrorType: error.ErrorType ?? null,
    ErrorMessage: error.ErrorMessage ?? null,
    StackTrace: error.StackTrace ?? null,
  } as ErrorObject;
}

/**
 * Serializes the full INLINE {@link DagResultEnvelope}: the shared aggregate
 * fields plus the per-task `tasks` array. This is the same envelope the
 * offloaded path emits, only WITH `tasks`.
 */
async function serializeDagResultEnvelope(
  value: DagResult,
  context: SerdesContext,
): Promise<DagResultEnvelope> {
  const tasks: SerializedDagTask[] = [];
  for (const exec of value.results.values()) {
    tasks.push(await serializeTask(exec, context));
  }
  return { ...buildEnvelopeAggregate(value), tasks };
}

/**
 * Builds the OFFLOADED container payload: the SAME {@link DagResultEnvelope} as
 * the inline case with `tasks` DROPPED (its absence is the signal to
 * reconstruct from the retained child operations). Applies the ordered
 * degradation ladder — if the tasks-dropped envelope is STILL over the
 * checkpoint size limit, drop `failedTaskNames` (set to `null`). Counts,
 * `completionReason` and `startedTaskNames` are never dropped, so a DAG can
 * never fail to checkpoint because its own summary did not fit.
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function buildDagOffloadPayload(result: DagResult): string {
  const envelope = buildEnvelopeAggregate(result);
  const withFailed = JSON.stringify(envelope);
  if (Buffer.byteLength(withFailed, "utf8") <= CHECKPOINT_SIZE_LIMIT_BYTES) {
    return withFailed;
  }
  // Ladder step 3: the tasks-dropped envelope is still too large. Drop the
  // unbounded `failedTaskNames` (it is diagnostic-only and never read on
  // replay — failed tasks are recovered from their own child checkpoints).
  envelope.failedTaskNames = null;
  return JSON.stringify(envelope);
}

/**
 * Restores a deserialized (plain) DAG envelope — or an already-methoded
 * {@link DagResultImpl} — into a fully-methoded {@link DagResult}, recursively
 * restoring `batch`/`dag` task results by their `resultKind`. Handles the
 * explicit-null task shape (unset fields are `null`, not omitted). Only the
 * INLINE envelope (with `tasks`) is restored here; the offloaded envelope is
 * handled by the reconstruct path.
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
    Array.isArray((data as DagResultEnvelope).tasks)
  ) {
    const s = data as DagResultEnvelope;
    const map = new Map<string, TaskExecution>();
    for (const t of s.tasks ?? []) {
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
    // Aggregate fields are authoritative (envelope contract rule 3); under
    // early completion they can legitimately differ from a recompute over the
    // reconstructed map. Fall back to deriving only if a malformed envelope
    // omits them.
    const authoritativeCounts =
      typeof s.successCount === "number" &&
      typeof s.failureCount === "number" &&
      typeof s.skippedCount === "number"
        ? {
            successCount: s.successCount,
            failureCount: s.failureCount,
            skippedCount: s.skippedCount,
          }
        : undefined;
    return new DagResultImpl(
      map,
      s.completionReason ?? "ALL_COMPLETED",
      s.totalCount,
      authoritativeCounts,
    );
  }
  // Nested-offload contract rule 1: an envelope WITHOUT a `tasks` array is the
  // OFFLOADED shape written by buildDagOffloadPayload (its absence is the
  // signal to reconstruct). It legitimately carries no per-task map, but it
  // DOES carry the authoritative aggregate — `totalCount`, the three counts and
  // `completionReason`. Preserve them. The previous fallthrough fabricated
  // `new DagResultImpl(new Map(), "ALL_COMPLETED", 0)`, which told callers a
  // DAG succeeded with zero tasks when the checkpoint said otherwise — a nested
  // DAG that failed tasks reported ALL_COMPLETED with totalCount 0. A caller
  // must never be told a DAG succeeded when the checkpoint says it did not.
  if (
    data &&
    typeof data === "object" &&
    (data as Partial<DagResultEnvelope>).type === "DagResult"
  ) {
    const s = data as Partial<DagResultEnvelope>;
    if (
      typeof s.totalCount === "number" &&
      typeof s.successCount === "number" &&
      typeof s.failureCount === "number" &&
      typeof s.skippedCount === "number"
    ) {
      const completionReason: DagCompletionReason =
        s.completionReason ??
        (s.failureCount > 0 ? "COMPLETED_WITH_FAILURES" : "ALL_COMPLETED");
      return new DagResultImpl(new Map(), completionReason, s.totalCount, {
        successCount: s.successCount,
        failureCount: s.failureCount,
        skippedCount: s.skippedCount,
      });
    }
  }
  return new DagResultImpl(new Map(), "ALL_COMPLETED", 0);
}

/**
 * Serdes for the aggregated {@link DagResult} container payload. Serializes the
 * single converged {@link DagResultEnvelope} (with `tasks`) and tags each
 * task's result with a lowercase `resultKind` discriminator so heterogeneous,
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
        ? JSON.stringify(await serializeDagResultEnvelope(value, context))
        : undefined,
    deserialize: async (
      data: string | undefined,
    ): Promise<DagResult | undefined> =>
      data ? restoreDagResult(JSON.parse(data)) : undefined,
  };
}

/**
 * Reads and validates the checkpointed offloaded {@link DagResultEnvelope} for
 * a DAG container (the payload written by {@link buildDagOffloadPayload}).
 * Returns `null` if missing or malformed, in which case reconstruction derives
 * greedily from per-task checkpoints with an empty STARTED set. Unknown extra
 * fields are ignored (envelope contract rule 4).
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function readDagEnvelope(
  executionContext: ExecutionContext,
  entityId: string | undefined,
): DagResultEnvelope | null {
  if (!entityId) {
    return null;
  }
  const stepData = executionContext.getStepData(entityId);
  const payload = stepData?.ContextDetails?.Result;
  if (!payload) {
    return null;
  }
  try {
    const parsed = JSON.parse(payload) as Partial<DagResultEnvelope>;
    const counts = [
      parsed.totalCount,
      parsed.successCount,
      parsed.failureCount,
      parsed.skippedCount,
    ];
    if (
      parsed &&
      parsed.type === "DagResult" &&
      counts.every(
        (n) => typeof n === "number" && Number.isInteger(n) && n >= 0,
      ) &&
      Array.isArray(parsed.startedTaskNames)
    ) {
      return parsed as DagResultEnvelope;
    }
  } catch {
    // fall through to null
  }
  return null;
}
