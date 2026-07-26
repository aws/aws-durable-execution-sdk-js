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
  DagPredicateError,
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

/** Coerce an unknown thrown value into an `Error` for use as a `cause`. */
const toCause = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

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
  private rejectRun: ((error: Error) => void) | undefined;

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
    await new Promise<void>((resolve, reject) => {
      this.resolveRun = resolve;
      this.rejectRun = reject;
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
    // Null-prototype: the map is keyed by customer-chosen task names. A dep
    // named `__proto__` would otherwise hit the prototype setter instead of
    // creating an own property (silent wrong/undefined dep). The task-name
    // validator also blocklists these names; this is defense-in-depth.
    const map: Record<string, unknown> = Object.create(null);
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
          let shouldRun: boolean;
          try {
            shouldRun = task.runIf(depsMap);
          } catch (error) {
            // A throwing runIf is a defect in deterministic predicate code,
            // not a business outcome. Abort the whole DAG with a typed error:
            // record NO terminal state for this task and reject run() so
            // dag(...) fails. This prevents a predicate defect from being
            // reinterpreted as a task FAILED and driving downstream
            // ALL_FAILED / ANY_FAILED / ALL_DONE compensation. We return from
            // tryStartNext immediately (prompt abort, no draining).
            this.abort(
              new DagPredicateError(task.name, undefined, toCause(error)),
            );
            return;
          }
          if (!shouldRun) {
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
    // Tasks are driven on a DETACHED promise: nothing ever awaits the promise
    // this `.then()` produces. The container body awaits a DIFFERENT chain —
    // the `run()` promise, rejected via `rejectRun` in `abort()`. Crucially, a
    // non-root task's `runIf` is evaluated inside this settlement continuation
    // (`onSettled` -> `tryStartNext`, in a `.then` that only runs once the
    // upstream has settled — not on the first synchronous scheduling pass). A
    // throw there rejects THIS detached promise, which has no handler, so it
    // surfaces as an unhandled promise rejection that escapes straight to the
    // Lambda runtime (`Runtime.UnhandledPromiseRejection`, carrying the raw
    // error) — Lambda then retries the invocation and the DAG container is
    // never marked failed. The per-call-site `try/catch` on `runIf` converts
    // that one known throw into a typed abort, but it leaves the detached
    // dispatch itself unguarded, so the scheduler is only ever one un-converted
    // throw away from leaking again. The terminal `.catch` below is the
    // STRUCTURAL guarantee: any scheduling-time throw on this chain is funneled
    // into `abort()`, which rejects the `run()` promise the container body
    // awaits, so the container is deterministically failed instead of the
    // error escaping. This is scoped to the scheduler's own promise — it is NOT
    // a process-global `unhandledRejection` handler.
    void Promise.resolve(task.executor(this.ctx, depsMap))
      .then(
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
      )
      .catch((error: unknown) => this.abort(toDurableError(error)));
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

  /**
   * Aborts the DAG with a typed error (a `runIf` predicate threw). Unlike
   * {@link finish}, this does NOT record a terminal state for any task — the
   * offending task is neither FAILED nor SKIPPED — and it rejects `run()`
   * rather than resolving it, so `dag(...)` fails and no aggregate DagResult is
   * built. Setting `finished` makes every later task settle a no-op: there is
   * no cancellation in the execution model, so in-flight tasks are not
   * cancelled and any work they already checkpointed stays checkpointed for a
   * later invocation to replay — but their outcome can no longer downgrade or
   * override this abort. The abort propagates immediately (no draining).
   */
  private abort(error: DurableOperationError): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.rejectRun?.(error);
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
    // Null-prototype: keyed by customer-chosen task names (see the live
    // buildDepsMap). Defense-in-depth alongside the task-name validator.
    const map: Record<string, unknown> = Object.create(null);
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

      if (startedSet.has(task.name)) {
        // The envelope is AUTHORITATIVE (§7.7/§8.1). A task the live run
        // recorded as STARTED — in-flight at early completion and excluded
        // from the authoritative success/failure counts — MUST reconstruct as
        // STARTED even if its underlying durable op happened to checkpoint
        // SUCCEEDED/FAILED before the invocation unwound. Consulting the
        // checkpoint status first (as this branch used to) would materialize
        // it SUCCEEDED/FAILED, making the `results` map disagree with the
        // envelope-sourced counts it is required to stay consistent with, and
        // making getStatus() differ live-vs-replay.
        results.set(task.name, { name: task.name, status: "STARTED" });
      } else if (status === "SUCCEEDED") {
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
          if (task.runIf) {
            let shouldRun: boolean;
            try {
              shouldRun = task.runIf(buildDepsMap(task));
            } catch (error) {
              // Reconstruct-path decision: this branch runs ONLY while
              // replaying a DAG container the live run checkpointed as
              // SUCCEEDED (large-payload completed replay). runIf is a pure,
              // deterministic predicate, so re-evaluating it here must
              // reproduce the live decision. A throw is therefore impossible
              // in a faithful replay: had the predicate thrown live it would
              // have aborted the DAG with DagPredicateError and the container
              // would have checkpointed FAILURE — it would never have reached
              // this success-replay path. A throw here thus signals a
              // non-deterministic predicate. We surface it as the SAME typed
              // error, staying loud and consistent with the live abort, rather
              // than silently masking it as SKIPPED or never-started. Thrown
              // (not aborted via a scheduler) because this is a plain function
              // with no run() promise to reject; the throw rejects the
              // reconstruct promise, which the child-context boundary maps the
              // same way as the live path.
              throw new DagPredicateError(task.name, undefined, toCause(error));
            }
            if (!shouldRun) {
              return "RUN_IF_PREDICATE";
            }
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
