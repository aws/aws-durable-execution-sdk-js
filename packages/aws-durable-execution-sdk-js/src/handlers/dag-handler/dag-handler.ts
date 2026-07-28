import type { DurableContextImpl } from "../../context/durable-context/durable-context";
import { DurablePromise } from "../../types/durable-promise";
import { DurableContext } from "../../types/durable-context";
import { DurableLogger } from "../../types/durable-logger";
import {
  DurableExecutionMode,
  ExecutionContext,
  OperationSubType,
} from "../../types/core";
import {
  DagCompletionConfig,
  DagConfig,
  DagContext,
  DagResult,
} from "../../types/dag";
import { ChildConfig } from "../../types/child-context";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";
import { DagContextImpl } from "./dag-context";
import { validateDag } from "./dag-validator";
import {
  DEFAULT_DAG_MAX_CONCURRENCY,
  DagExecutor,
  reconstructDagResult,
} from "./dag-executor";
import {
  buildDagOffloadPayload,
  createDagResultSerdes,
  readDagEnvelope,
} from "./dag-result";

/**
 * DAG-local copy of the batch `validateMaxConcurrency` guard (the DAG does
 * not route through the concurrent-execution handler). A non-positive
 * `maxConcurrency` is a deterministic, non-retryable configuration error:
 * terminates the execution rather than throwing, so a misconfigured call
 * fails cleanly instead of being retried by Lambda only to fail identically
 * again. Returns `true` when valid.
 */
function validateDagMaxConcurrency(
  maxConcurrency: number | undefined | null,
  terminationManager: TerminationManager,
): boolean {
  if (
    maxConcurrency !== undefined &&
    maxConcurrency !== null &&
    maxConcurrency <= 0
  ) {
    const message = `Invalid maxConcurrency: ${maxConcurrency}. Must be a positive number or undefined to use the default (${DEFAULT_DAG_MAX_CONCURRENCY}).`;
    terminationManager.terminate({
      reason: TerminationReason.CONFIG_VALIDATION_ERROR,
      message,
      error: new Error(message),
    });
    return false;
  }
  return true;
}

/**
 * DAG-local copy of the batch `validateCompletionConfig` guard (the DAG does
 * not route through the concurrent-execution handler). Terminates with a
 * non-retryable config error when a custom predicate is combined with the
 * mutually-exclusive threshold fields. Returns `true` when valid.
 */
function validateDagCompletionConfig(
  completion: DagCompletionConfig | undefined,
  terminationManager: TerminationManager,
): boolean {
  const c = completion as
    | {
        shouldComplete?: unknown;
        minSuccessful?: unknown;
        toleratedFailureCount?: unknown;
        toleratedFailurePercentage?: unknown;
      }
    | undefined;
  if (
    c?.shouldComplete !== undefined &&
    (c.minSuccessful !== undefined ||
      c.toleratedFailureCount !== undefined ||
      c.toleratedFailurePercentage !== undefined)
  ) {
    const message =
      "completionConfig.shouldComplete is mutually exclusive with " +
      "minSuccessful, toleratedFailureCount, and toleratedFailurePercentage";
    terminationManager.terminate({
      reason: TerminationReason.CONFIG_VALIDATION_ERROR,
      message,
      error: new Error(message),
    });
    return false;
  }
  return true;
}

/**
 * Builds the `context.dag()` handler. Wraps registration + scheduling in a
 * child context whose entity ID is the DAG container; each task runs under a
 * name-based explicit-ID variant. Pre-body config guards fire before the child
 * context is entered; `validateDag` runs after `register` inside the body. On
 * the large-payload completed-replay path the aggregate is reconstructed from
 * the SDK envelope + per-task checkpoints (no re-scheduling).
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export const createDagHandler =
  <Logger extends DurableLogger>(
    runInChildContext: DurableContext<Logger>["runInChildContext"],
    executionContext: ExecutionContext,
  ) =>
  (
    name: string,
    register: (dagCtx: DagContext<Logger>) => void | Promise<void>,
    config?: DagConfig,
  ): DurablePromise<DagResult> =>
    new DurablePromise<DagResult>(async () => {
      // Config guards (pure functions of `config`) run before the child context.
      // Invalid maxConcurrency is a deterministic, non-retryable configuration
      // error: terminate the execution rather than throwing. If it terminated,
      // stop here with a never-resolving promise so we don't proceed.
      if (
        !validateDagMaxConcurrency(
          config?.maxConcurrency,
          executionContext.terminationManager,
        )
      ) {
        return new Promise<DagResult>(() => {});
      }
      if (
        !validateDagCompletionConfig(
          config?.completionConfig,
          executionContext.terminationManager,
        )
      ) {
        return new Promise<DagResult>(() => {});
      }

      const childOptions: ChildConfig<DagResult> = {
        subType: OperationSubType.DAG,
        serdes: config?.serdes ?? createDagResultSerdes(),
        // Offloaded (large-payload) fallback: the SAME converged envelope as
        // the inline serdes, only with `tasks` dropped (its absence signals
        // reconstruct). The ordered degradation ladder lives in
        // buildDagOffloadPayload. There is no customer summary generator — the
        // whole envelope is human-readable.
        summaryGenerator: (result: DagResult) => buildDagOffloadPayload(result),
        errorMapper: (e) => e,
      };

      return runInChildContext(
        name,
        async (parentCtx): Promise<DagResult> => {
          const dagCtx = new DagContextImpl<Logger>(config);
          await register(dagCtx);
          const tasks = dagCtx.getTasks();
          validateDag(tasks);

          const executorCtx =
            parentCtx as unknown as DurableContextImpl<DurableLogger>;
          const modeHost = parentCtx as unknown as {
            durableExecutionMode: DurableExecutionMode;
            _stepPrefix?: string;
          };
          if (
            modeHost.durableExecutionMode ===
            DurableExecutionMode.ReplaySucceededContext
          ) {
            const envelope = readDagEnvelope(
              executionContext,
              modeHost._stepPrefix,
            );
            return reconstructDagResult(
              executorCtx,
              tasks,
              envelope,
              executionContext,
            );
          }

          const executor = new DagExecutor(executorCtx, tasks, config);
          return executor.run();
        },
        childOptions,
      );
    });
