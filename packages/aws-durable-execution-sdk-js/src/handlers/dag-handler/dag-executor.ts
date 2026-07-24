import type { DurableContextImpl } from "../../context/durable-context/durable-context";
import { DurableLogger } from "../../types/durable-logger";
import {
  CompletionOutcome,
  ThresholdCompletionConfig,
} from "../../types/batch";
import {
  DagCompletionItemStatus,
  DagCompletionReason,
  DagCompletionStatus,
  DagConfig,
  DagCustomCompletionConfig,
  DagResult,
  DagSummary,
  SkipReason,
  TaskExecution,
  TaskStatus,
  TriggerRule,
} from "../../types/dag";
import {
  DurableOperationError,
  StepError,
} from "../../errors/durable-error/durable-error";
import { TaskDef } from "./task-handle";
import { triggerRuleEvaluators } from "./trigger-rules";
import { DagResultImpl, restoreDagResult } from "./dag-result";
import { ExecutionContext } from "../../types/core";
import { ErrorObject } from "@aws-sdk/client-lambda";
import { restoreBatchResult } from "../concurrent-execution-handler/batch-result";

const toDurableError = (error: unknown): DurableOperationError => {
  if (error instanceof DurableOperationError) {
    return error;
  }
  const cause = error instanceof Error ? error : new Error(String(error));
  return new StepError(cause.message, cause);
};

/**
 * Topological scheduler for a registered DAG. Starts ready tasks concurrently
 * (bounded by `maxConcurrency`), evaluates per-task trigger rules and `runIf`
 * predicates, propagates skips, and aggregates task outcomes into a
 * {@link DagResult}. Failed tasks are terminal states (not aborts): by default
 * the reachable graph is drained; a `completionConfig` can stop it early.
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class DagExecutor {
  private readonly results = new Map<string, TaskExecution>();
  private readonly inFlight = new Set<string>();
  private readonly maxConcurrency: number;
  private finished = false;
  private completionReason: DagCompletionReason = "ALL_COMPLETED";
  private resolveRun: (() => void) | undefined;

  constructor(
    private readonly ctx: DurableContextImpl<DurableLogger>,
    private readonly tasks: TaskDef[],
    private readonly config?: DagConfig,
  ) {
    this.maxConcurrency = config?.maxConcurrency ?? Infinity;
  }

  async run(): Promise<DagResult> {
    if (this.tasks.length === 0) {
      return new DagResultImpl(new Map(), "ALL_COMPLETED", 0);
    }
    await new Promise<void>((resolve) => {
      this.resolveRun = resolve;
      this.tryStartNext();
    });
    return new DagResultImpl(
      this.results,
      this.completionReason,
      this.tasks.length,
    );
  }

  private isReady(task: TaskDef): boolean {
    return task.allDeps.every((d) => this.results.has(d.name));
  }

  private depStatuses(task: TaskDef): TaskStatus[] {
    return task.allDeps.map(
      (d) => (this.results.get(d.name) as TaskExecution).status,
    );
  }

  private buildDepsMap(task: TaskDef): Record<string, unknown> {
    const map: Record<string, unknown> = {};
    for (const dep of task.inlineDeps) {
      const exec = this.results.get(dep.name);
      map[dep.name] =
        exec && exec.status === "SUCCEEDED" ? exec.result : undefined;
    }
    return map;
  }

  private resolveTriggerRule(task: TaskDef): TriggerRule {
    return task.triggerRule ?? this.config?.defaultTriggerRule ?? "ALL_SUCCESS";
  }

  private recordSkip(task: TaskDef, reason: SkipReason): void {
    this.results.set(task.name, {
      name: task.name,
      status: "SKIPPED",
      skipReason: reason,
    });
  }

  private tryStartNext(): void {
    if (this.finished) {
      return;
    }
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const task of this.tasks) {
        if (this.results.has(task.name) || this.inFlight.has(task.name)) {
          continue;
        }
        if (!this.isReady(task)) {
          continue;
        }
        // Ready: evaluate the trigger rule against dep statuses.
        const rule = this.resolveTriggerRule(task);
        if (!triggerRuleEvaluators[rule](this.depStatuses(task))) {
          this.recordSkip(task, "TRIGGER_RULE");
          progressed = true;
          continue;
        }
        // Trigger passed: evaluate runIf.
        if (task.runIf) {
          const depsMap = this.buildDepsMap(task);
          if (!task.runIf(depsMap)) {
            this.recordSkip(task, "RUN_IF_PREDICATE");
            progressed = true;
            continue;
          }
        }
        // Task must run.
        if (this.inFlight.size >= this.maxConcurrency) {
          continue;
        }
        this.startTask(task);
        progressed = true;
      }
    }
    this.checkDone();
  }

  private startTask(task: TaskDef): void {
    this.inFlight.add(task.name);
    const startedAt = new Date();
    const depsMap = this.buildDepsMap(task);
    Promise.resolve(task.executor(this.ctx, depsMap)).then(
      (result) =>
        this.onSettled(task, {
          name: task.name,
          status: "SUCCEEDED",
          result,
          startedAt,
          completedAt: new Date(),
        }),
      (error) =>
        this.onSettled(task, {
          name: task.name,
          status: "FAILED",
          error: toDurableError(error),
          startedAt,
          completedAt: new Date(),
        }),
    );
  }

  private onSettled(task: TaskDef, exec: TaskExecution): void {
    if (this.finished) {
      return;
    }
    this.inFlight.delete(task.name);
    this.results.set(task.name, exec);
    if (this.config?.completionConfig && this.evaluateCompletion()) {
      return;
    }
    this.tryStartNext();
  }

  private checkDone(): void {
    if (this.finished) {
      return;
    }
    // No task is running and the ready-loop started nothing new: the reachable
    // graph is drained (acyclicity guarantees every task's deps eventually
    // become terminal, so nothing is left blocked with an idle scheduler).
    if (this.inFlight.size === 0) {
      const { failureCount } = this.counts();
      this.finish(
        failureCount > 0 ? "COMPLETED_WITH_FAILURES" : "ALL_COMPLETED",
      );
    }
  }

  private finish(reason: DagCompletionReason): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.completionReason = reason;
    // In-flight tasks are not awaited at early completion; record them STARTED.
    for (const name of this.inFlight) {
      if (!this.results.has(name)) {
        this.results.set(name, { name, status: "STARTED" });
      }
    }
    this.resolveRun?.();
  }

  private counts(): {
    successCount: number;
    failureCount: number;
    skippedCount: number;
  } {
    let successCount = 0;
    let failureCount = 0;
    let skippedCount = 0;
    for (const exec of this.results.values()) {
      if (exec.status === "SUCCEEDED") {
        successCount++;
      } else if (exec.status === "FAILED") {
        failureCount++;
      } else if (exec.status === "SKIPPED") {
        skippedCount++;
      }
    }
    return { successCount, failureCount, skippedCount };
  }

  private buildCompletionStatus(): DagCompletionStatus {
    const items: DagCompletionItemStatus[] = this.tasks.map((t) => {
      const exec = this.results.get(t.name);
      return {
        name: t.name,
        status: exec?.status,
        result: exec?.status === "SUCCEEDED" ? exec.result : undefined,
        skipReason: exec?.skipReason,
      };
    });
    const resultsMap = new Map<string, DagCompletionItemStatus>();
    for (const item of items) {
      if (item.status) {
        resultsMap.set(item.name, item);
      }
    }
    const { successCount, failureCount, skippedCount } = this.counts();
    return {
      successCount,
      failureCount,
      skippedCount,
      completedCount: successCount + failureCount + skippedCount,
      totalCount: this.tasks.length,
      items,
      results: resultsMap,
    };
  }

  /** Returns true (and calls finish) if a completion policy stopped the DAG. */
  private evaluateCompletion(): boolean {
    const completion = this.config?.completionConfig;
    if (!completion) {
      return false;
    }
    const custom = completion as DagCustomCompletionConfig;
    if (typeof custom.shouldComplete === "function") {
      const decision = custom.shouldComplete(this.buildCompletionStatus());
      if (decision.complete) {
        this.finish(
          decision.outcome === CompletionOutcome.FAILED
            ? "CUSTOM_COMPLETION_FAILED"
            : "CUSTOM_COMPLETION_SUCCEEDED",
        );
        return true;
      }
      return false;
    }
    const threshold = completion as ThresholdCompletionConfig;
    const { successCount, failureCount } = this.counts();
    const total = this.tasks.length;
    if (
      threshold.toleratedFailureCount !== undefined &&
      failureCount > threshold.toleratedFailureCount
    ) {
      this.finish("FAILURE_TOLERANCE_EXCEEDED");
      return true;
    }
    if (
      threshold.toleratedFailurePercentage !== undefined &&
      (failureCount / total) * 100 > threshold.toleratedFailurePercentage
    ) {
      this.finish("FAILURE_TOLERANCE_EXCEEDED");
      return true;
    }
    if (
      threshold.minSuccessful !== undefined &&
      successCount >= threshold.minSuccessful
    ) {
      this.finish("MIN_SUCCESSFUL_REACHED");
      return true;
    }
    return false;
  }
}

/**
 * Reconstructs a {@link DagResult} on the large-payload completed-replay path
 * WITHOUT re-scheduling: re-runs only the deterministic register graph + skip/
 * trigger recomputation, reads per-task results from checkpoints, and sources
 * counts/reason/started-set from the SDK-owned {@link DagSummary} envelope.
 *
 * @internal
 */
export async function reconstructDagResult(
  ctx: DurableContextImpl<DurableLogger>,
  tasks: TaskDef[],
  envelope: DagSummary | null,
  executionContext: ExecutionContext,
): Promise<DagResult> {
  const results = new Map<string, TaskExecution>();
  const startedSet = new Set(envelope?.startedTaskNames ?? []);
  const terminalSet = new Set(envelope?.terminalTaskNames ?? []);

  const buildDepsMap = (task: TaskDef): Record<string, unknown> => {
    const map: Record<string, unknown> = {};
    for (const dep of task.inlineDeps) {
      const exec = results.get(dep.name);
      map[dep.name] =
        exec && exec.status === "SUCCEEDED" ? exec.result : undefined;
    }
    return map;
  };

  const readResult = (task: TaskDef, payload: string | undefined): unknown => {
    if (payload === undefined) {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return payload;
    }
    if (task.kind === "map" || task.kind === "parallel") {
      return restoreBatchResult(parsed);
    }
    if (task.kind === "dag") {
      return restoreDagResult(parsed);
    }
    return parsed;
  };

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const task of tasks) {
      if (results.has(task.name)) {
        continue;
      }
      if (!task.allDeps.every((d) => results.has(d.name))) {
        continue;
      }
      const entityId = ctx.createTaskId(task.name);
      const stepData = executionContext.getStepData(entityId);
      const detail = stepData as
        | {
            Status?: string;
            StepDetails?: { Result?: string; Error?: ErrorObject };
            ContextDetails?: { Result?: string; Error?: ErrorObject };
            ChainedInvokeDetails?: { Result?: string; Error?: ErrorObject };
            CallbackDetails?: { Result?: string; Error?: ErrorObject };
            WaitDetails?: { Result?: string; Error?: ErrorObject };
          }
        | undefined;
      const status = detail?.Status;
      const resultPayload =
        detail?.StepDetails?.Result ??
        detail?.ContextDetails?.Result ??
        detail?.ChainedInvokeDetails?.Result ??
        detail?.CallbackDetails?.Result ??
        detail?.WaitDetails?.Result;
      const errorObject =
        detail?.StepDetails?.Error ??
        detail?.ContextDetails?.Error ??
        detail?.ChainedInvokeDetails?.Error ??
        detail?.CallbackDetails?.Error ??
        detail?.WaitDetails?.Error;

      if (status === "SUCCEEDED") {
        results.set(task.name, {
          name: task.name,
          status: "SUCCEEDED",
          result: readResult(task, resultPayload),
        });
      } else if (status === "FAILED") {
        results.set(task.name, {
          name: task.name,
          status: "FAILED",
          error: errorObject
            ? DurableOperationError.fromErrorObject(errorObject)
            : new StepError("Unknown error"),
        });
      } else if (startedSet.has(task.name)) {
        results.set(task.name, { name: task.name, status: "STARTED" });
      } else {
        // No checkpoint and not in the STARTED set. The task was either
        // SKIPPED live (a skip checkpoints nothing, §9.5) or NEVER STARTED
        // because early completion halted the scheduler before it was ever
        // evaluated (§5.7, §9.6). These two must not be conflated on replay.
        const depStatuses = task.allDeps.map(
          (d) => (results.get(d.name) as TaskExecution).status,
        );
        const computeSkipReason = (): SkipReason | undefined => {
          const rule = task.triggerRule ?? "ALL_SUCCESS";
          if (!triggerRuleEvaluators[rule](depStatuses)) {
            return "TRIGGER_RULE";
          }
          if (task.runIf && !task.runIf(buildDepsMap(task))) {
            return "RUN_IF_PREDICATE";
          }
          return undefined;
        };
        if (envelope) {
          // The envelope's terminal set is AUTHORITATIVE (§7.7/§8.1). A
          // no-checkpoint task is SKIPPED iff the envelope lists it as
          // terminal; otherwise it was never started under early completion
          // and MUST stay absent. Greedily re-materializing it as SKIPPED
          // would diverge from the live run, because live scheduling halts on
          // the completing settle BEFORE the settle-triggered skip pass runs,
          // so a skip-eligible task downstream of the completing task is
          // absent live — it must be absent on replay too.
          if (terminalSet.has(task.name)) {
            results.set(task.name, {
              name: task.name,
              status: "SKIPPED",
              skipReason: computeSkipReason() ?? "TRIGGER_RULE",
            });
          }
          // else: never started — leave absent.
        } else {
          // No/malformed envelope (§8.1 contract 3): derive greedily from the
          // per-task checkpoints with an empty STARTED set. Respect the
          // in-flight guard — a task downstream of a STARTED (non-terminal)
          // dep was never evaluated live, so recomputing a skip against that
          // non-terminal status would diverge.
          if (depStatuses.some((s) => s === "STARTED")) {
            // Downstream of an in-flight task: never started. Leave absent.
          } else {
            const reason = computeSkipReason();
            if (reason) {
              results.set(task.name, {
                name: task.name,
                status: "SKIPPED",
                skipReason: reason,
              });
            }
            // else: would-run but no checkpoint and not STARTED => never
            // started (early completion). Leave absent from results.
          }
        }
      }
      if (results.has(task.name)) {
        progressed = true;
      }
    }
  }

  const derivedFailureCount = [...results.values()].filter(
    (e) => e.status === "FAILED",
  ).length;
  const completionReason: DagCompletionReason =
    envelope?.completionReason ??
    (derivedFailureCount > 0 ? "COMPLETED_WITH_FAILURES" : "ALL_COMPLETED");
  const totalCount = envelope?.totalCount ?? tasks.length;
  // When the envelope is present its counts are authoritative (§7.7/§8.1):
  // they reflect the live run and may legitimately differ from a greedy
  // recompute over the reconstructed `results` map under early completion.
  const authoritativeCounts = envelope
    ? {
        successCount: envelope.successCount,
        failureCount: envelope.failureCount,
        skippedCount: envelope.skippedCount,
      }
    : undefined;
  return new DagResultImpl(
    results,
    completionReason,
    totalCount,
    authoritativeCounts,
  );
}
