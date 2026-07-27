import {
  ExecutionContext,
  DurableContext,
  BatchItemStatus,
  DurableExecutionMode,
  ConcurrencyConfig,
  ConcurrentExecutionItem,
  ConcurrentExecutor,
  BatchResult,
  BatchItem,
  CompletionReason,
  CompletionStatus,
  CompletionItemStatus,
  CompletionConfig,
  CompletionOutcome,
  DurablePromise,
  DurableLogger,
  NestingType,
} from "../../types";
import { OperationStatus } from "@aws-sdk/client-lambda";
import { log } from "../../utils/logger/logger";
import {
  BatchResultImpl,
  restoreBatchResult,
  createBatchResultSerdes,
} from "./batch-result";
import { AnySerdes } from "../../utils/serdes/serdes";
import { ChildContextError } from "../../errors/durable-error/durable-error";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";

/**
 * Valid {@link CompletionReason} values, used to validate a reason read back
 * from a checkpointed summary. Typed as `Record<CompletionReason, true>` so it
 * is exhaustive by construction: adding a value to the {@link CompletionReason}
 * union turns this into a compile error until the new value is listed here — the
 * validator can never silently omit a reason (and no extra public API is
 * exported to keep it in sync). A reason not present here (a malformed or
 * hand-authored summary) is ignored so an arbitrary string can never leak into
 * {@link BatchResult.completionReason}; replay re-infers the reason from the
 * reconstructed items instead.
 */
const VALID_COMPLETION_REASONS: Record<CompletionReason, true> = {
  ALL_COMPLETED: true,
  MIN_SUCCESSFUL_REACHED: true,
  FAILURE_TOLERANCE_EXCEEDED: true,
  CUSTOM_COMPLETION_SUCCEEDED: true,
  CUSTOM_COMPLETION_FAILED: true,
};

/**
 * Validates that a custom `shouldComplete` predicate is not combined with the
 * threshold fields (the two completion mechanisms are mutually exclusive). The
 * public {@link CompletionConfig} type expresses this at compile time; this
 * guard protects plain-JavaScript callers.
 *
 * A configuration error is not retryable, so rather than throwing (which the
 * durable runtime could treat as a customer error), it terminates the
 * execution with a validation reason — mirroring how `validateContextUsage`
 * reports context misuse. Returns `true` when the config is valid, or `false`
 * when it terminated the execution (the caller must then stop).
 */
function validateCompletionConfig(
  completion: CompletionConfig | undefined,
  terminationManager: TerminationManager,
): boolean {
  if (
    completion?.shouldComplete !== undefined &&
    (completion.minSuccessful !== undefined ||
      completion.toleratedFailureCount !== undefined ||
      completion.toleratedFailurePercentage !== undefined)
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

export class ConcurrencyController<Logger extends DurableLogger> {
  constructor(
    private readonly operationName: string,

    private readonly getDefaultSerdes?: () => AnySerdes,
  ) {}

  /**
   * Advance the step cursor of the context that {@link replayItems} re-drives
   * child operations on, for a non-terminal item that is NOT re-executed on
   * replay (one that was in flight at suspension, or never started).
   *
   * This MUST advance the SAME context that runInChildContext runs on
   * (`parentContext` — the map/parallel child context), not the outer context
   * that owns the map/parallel call. If a skipped in-flight item does not
   * advance this cursor, the next terminal item's runInChildContext peeks the
   * pending non-terminal step, `checkForNonResolvingPromise` returns a
   * never-resolving promise, and replay hangs (issue #751). `skipNextOperation`
   * is internal to the durable context, so it is reached through a narrow cast
   * (the same pattern used to read `_stepPrefix`/`durableExecutionMode`).
   */
  private skipReplayStep(parentContext: DurableContext<Logger>): void {
    (
      parentContext as unknown as { skipNextOperation: () => void }
    ).skipNextOperation();
  }

  private getCompletionReason<T, R>(
    failureCount: number,
    successCount: number,
    completedCount: number,
    items: ConcurrentExecutionItem<T>[],
    config: ConcurrencyConfig<R>,
    itemStatuses: readonly CompletionItemStatus[],
  ): CompletionReason {
    // Check tolerance first, before checking if all completed
    const completion = config.completionConfig;

    // A custom shouldComplete predicate owns the completion decision. Its
    // returned outcome determines whether the early completion is reported as
    // a success or a failure. If the predicate does not complete the batch,
    // the batch is ending because every item finished (ALL_COMPLETED).
    if (completion?.shouldComplete) {
      const decision = completion.shouldComplete({
        successCount,
        failureCount,
        completedCount,
        totalCount: items.length,
        items: itemStatuses,
      });
      if (decision.complete) {
        return decision.outcome === CompletionOutcome.FAILED
          ? "CUSTOM_COMPLETION_FAILED"
          : "CUSTOM_COMPLETION_SUCCEEDED";
      }
      return "ALL_COMPLETED";
    }

    // Handle fail-fast behavior (no completion config or empty completion config)
    if (!completion) {
      if (failureCount > 0) return "FAILURE_TOLERANCE_EXCEEDED";
    } else {
      const hasAnyCompletionCriteria = Object.values(completion).some(
        (value) => value !== undefined,
      );
      if (!hasAnyCompletionCriteria) {
        if (failureCount > 0) return "FAILURE_TOLERANCE_EXCEEDED";
      } else {
        // Check specific tolerance thresholds
        if (
          completion.toleratedFailureCount !== undefined &&
          failureCount > completion.toleratedFailureCount
        ) {
          return "FAILURE_TOLERANCE_EXCEEDED";
        }
        if (completion.toleratedFailurePercentage !== undefined) {
          const failurePercentage = (failureCount / items.length) * 100;
          if (failurePercentage > completion.toleratedFailurePercentage) {
            return "FAILURE_TOLERANCE_EXCEEDED";
          }
        }
      }
    }

    // Check other completion reasons
    if (completedCount === items.length) return "ALL_COMPLETED";
    if (
      config.completionConfig?.minSuccessful !== undefined &&
      successCount >= config.completionConfig.minSuccessful
    )
      return "MIN_SUCCESSFUL_REACHED";

    return "ALL_COMPLETED";
  }

  async executeItems<T, R>(
    items: ConcurrentExecutionItem<T>[],
    executor: ConcurrentExecutor<T, R, Logger>,
    parentContext: DurableContext<Logger>,
    config: ConcurrencyConfig<R>,
    durableExecutionMode: DurableExecutionMode = DurableExecutionMode.ExecutionMode,
    entityId?: string,
    executionContext?: ExecutionContext,
  ): Promise<BatchResult<R>> {
    // In replay mode, we're reconstructing the result from child contexts
    if (durableExecutionMode === DurableExecutionMode.ReplaySucceededContext) {
      log("🔄", `Replay mode: Reconstructing ${this.operationName} result:`, {
        itemCount: items.length,
      });

      // Recover the recorded completion reason from the checkpointed summary.
      // This is the ONLY field read back from the summary: counts, the started
      // set, and per-item status are all derived from the child checkpoints in
      // replayItems (the items array is the same deterministic input, so
      // items.length is the authoritative total). The completion reason is the
      // one value that cannot be safely re-derived — for a custom
      // `shouldComplete` predicate, re-invoking it on the reconstructed
      // (terminal-only) set is exactly what produced non-deterministic replay,
      // so we read the value the live run recorded instead.
      let recordedCompletionReason: CompletionReason | undefined;
      if (entityId && executionContext) {
        const stepData = executionContext.getStepData(entityId);
        const summaryPayload = stepData?.ContextDetails?.Result;
        if (summaryPayload) {
          recordedCompletionReason =
            this.parseRecordedCompletionReason(summaryPayload);
          log("📊", "Recovered completion reason from summary:", {
            recordedCompletionReason,
          });
        }
      }

      // Always reconstruct from child checkpoints when we have the context to
      // do so. Deriving from checkpoints — rather than falling back to
      // concurrent execution while the context is in ReplaySucceededContext
      // mode — is what prevents the replay hang: in that mode a non-terminal
      // child yields a never-resolving promise, so any batch with a live
      // in-flight item could never settle. The fallback below only applies
      // when there is no context to reconstruct from (which does not happen for
      // map/parallel).
      if (entityId && executionContext) {
        return await this.replayItems(
          items,
          executor,
          parentContext,
          config,
          recordedCompletionReason,
          executionContext,
          entityId,
        );
      } else {
        log(
          "⚠️",
          "No entity id or execution context found, falling back to concurrent execution",
        );
      }
    }

    // First-time execution or fallback: use normal concurrent execution logic
    return await this.executeItemsConcurrently(
      items,
      executor,
      parentContext,
      config,
    );
  }

  /**
   * Extracts a recorded `completionReason` from a checkpointed batch summary.
   *
   * The summary is stored as a raw JSON string (written by the composed summary
   * generator), so it is parsed directly rather than routed through a
   * BatchResult serdes. Returns `undefined` when the payload is missing,
   * unparseable, or does not carry a string `completionReason` (e.g. an old
   * checkpoint written by a pre-fix custom generator that returned a free-form
   * string) — in that case replayItems re-infers the reason from the
   * reconstructed items.
   */
  private parseRecordedCompletionReason(
    summaryPayload: unknown,
  ): CompletionReason | undefined {
    if (typeof summaryPayload !== "string") {
      return undefined;
    }
    try {
      const parsed = JSON.parse(summaryPayload);
      if (parsed && typeof parsed === "object") {
        const reason = (parsed as Record<string, unknown>).completionReason;
        // Only trust a recognised CompletionReason. An unknown/arbitrary value
        // (malformed or hand-authored summary) is ignored so it cannot leak
        // into BatchResult.completionReason; replayItems re-infers instead.
        // hasOwnProperty (not `in`) so inherited keys like "constructor" or
        // "toString" from a crafted summary are not treated as valid.
        if (
          typeof reason === "string" &&
          Object.prototype.hasOwnProperty.call(VALID_COMPLETION_REASONS, reason)
        ) {
          return reason as CompletionReason;
        }
      }
    } catch {
      // Unparseable summary (e.g. a legacy free-form custom-generator string):
      // fall through and let replayItems re-infer from child checkpoints.
      log("⚠️", "Could not parse batch summary for completion reason");
    }
    return undefined;
  }

  private async replayItems<T, R>(
    items: ConcurrentExecutionItem<T>[],
    executor: ConcurrentExecutor<T, R, Logger>,
    parentContext: DurableContext<Logger>,
    config: ConcurrencyConfig<R>,
    recordedCompletionReason: CompletionReason | undefined,
    executionContext: ExecutionContext,
    parentEntityId: string,
  ): Promise<BatchResult<R>> {
    const resultItems: Array<BatchItem<R>> = [];

    log("🔄", `Replaying ${items.length} items from child checkpoints`, {
      recordedCompletionReason,
    });

    let stepCounter = 0;

    // Reconstruct the completed items from the child checkpoints. Items are
    // started in strict index order (tryStartNext), so each item at position
    // `stepCounter` maps to the child entity `${parent}-{n}`. A child that
    // finished has a terminal checkpoint (its result/error is returned from
    // cache); any non-terminal child (in flight at suspension, or never
    // started) is skipped. The recorded completionReason carries the batch
    // outcome, so the started set does not need to be persisted or rebuilt.
    for (const item of items) {
      const childEntityId = `${parentEntityId}-${stepCounter + 1}`;
      const childStepData = executionContext.getStepData(childEntityId);
      const isTerminal =
        !!childStepData &&
        (childStepData.Status === OperationStatus.SUCCEEDED ||
          childStepData.Status === OperationStatus.FAILED);

      if (isTerminal) {
        // Terminal child: re-drive runInChildContext so it returns the cached
        // checkpointed result (it is not re-executed) and consumes its step id.
        try {
          const result = await parentContext.runInChildContext(
            item.name || item.id,
            (childContext) => executor(item, childContext),
            {
              subType: config.iterationSubType,
              serdes: config.itemSerdes,
              virtualContext: config.nesting === NestingType.FLAT,
            },
          );

          resultItems.push({
            result,
            index: item.index,
            status: BatchItemStatus.SUCCEEDED,
          });

          log("✅", `Replayed ${this.operationName} item:`, {
            index: item.index,
            itemId: item.id,
          });
        } catch (error) {
          const err =
            error instanceof ChildContextError
              ? error
              : new ChildContextError(
                  error instanceof Error ? error.message : String(error),
                  error instanceof Error ? error : undefined,
                );
          resultItems.push({
            error: err,
            index: item.index,
            status: BatchItemStatus.FAILED,
          });

          log("❌", `Replay failed for ${this.operationName} item:`, {
            index: item.index,
            itemId: item.id,
            error: err.message,
          });
        }
        stepCounter++;
      } else {
        // Non-terminal child at suspension (in flight, or never started). It is
        // NOT re-executed and NOT added to the reconstructed result. Its step
        // is skipped on THIS context so the next terminal item's
        // runInChildContext peeks its own step rather than this pending one —
        // this is what keeps replay from hanging on the non-resolving-promise
        // gate (issue #751). In-flight items are intentionally not rebuilt as
        // STARTED placeholders: summarized replay reports the completed items,
        // and the recorded completionReason is used for the batch outcome.
        this.skipReplayStep(parentContext);
        stepCounter++;

        log("⏭️", `Skipping non-terminal item during replay:`, {
          index: item.index,
          itemId: item.id,
          childEntityId,
        });
      }
    }

    const successCount = resultItems.filter(
      (item) => item.status === BatchItemStatus.SUCCEEDED,
    ).length;
    const failureCount = resultItems.filter(
      (item) => item.status === BatchItemStatus.FAILED,
    ).length;
    const completedCount = successCount + failureCount;

    log("🎉", `${this.operationName} replay completed:`, {
      successCount,
      failureCount,
      startedCount: resultItems.filter(
        (item) => item.status === BatchItemStatus.STARTED,
      ).length,
      totalCount: resultItems.length,
    });

    // Prefer the completion reason the live run recorded. Re-inferring it here
    // would re-invoke a custom shouldComplete predicate against the
    // reconstructed set, which is not guaranteed to match the live decision.
    // Only fall back to inference for legacy/malformed summaries that carry no
    // recorded reason.
    let completionReason = recordedCompletionReason;
    if (completionReason === undefined) {
      const statusByIndex = new Map<number, BatchItemStatus>();
      for (const r of resultItems) {
        statusByIndex.set(r.index, r.status);
      }
      const itemStatuses: CompletionItemStatus[] = items.map((item) => ({
        index: item.index,
        name: item.name,
        status: statusByIndex.get(item.index),
      }));
      completionReason = this.getCompletionReason(
        failureCount,
        successCount,
        completedCount,
        items,
        config,
        itemStatuses,
      );
    }

    return new BatchResultImpl(resultItems, completionReason);
  }

  private async executeItemsConcurrently<T, R>(
    items: ConcurrentExecutionItem<T>[],
    executor: ConcurrentExecutor<T, R, Logger>,
    parentContext: DurableContext<Logger>,
    config: ConcurrencyConfig<R>,
  ): Promise<BatchResult<R>> {
    const maxConcurrency = config.maxConcurrency || Infinity;
    const resultItems: Array<BatchItem<R> | undefined> = new Array(
      items.length,
    );
    const startedItems = new Set<number>();

    let activeCount = 0;
    let currentIndex = 0;
    let completedCount = 0;
    let successCount = 0;
    let failureCount = 0;

    log("🚀", `Starting ${this.operationName} with concurrency control:`, {
      itemCount: items.length,
      maxConcurrency,
    });

    return new Promise<BatchResult<R>>((resolve) => {
      // Snapshot of every item/branch ordered by original index, so a custom
      // predicate can reason about which specific items finished (not just how
      // many). Only built when a shouldComplete predicate is configured.
      const buildItemStatuses = (): CompletionItemStatus[] =>
        items.map((item) => ({
          index: item.index,
          name: item.name,
          status: resultItems[item.index]?.status,
        }));

      const buildCompletionStatus = (): CompletionStatus => ({
        successCount,
        failureCount,
        completedCount,
        totalCount: items.length,
        items: buildItemStatuses(),
      });

      const shouldContinue = (): boolean => {
        const completion = config.completionConfig;
        if (!completion) return failureCount === 0;

        // A custom predicate fully owns the "keep going?" decision: stop
        // starting new items as soon as it signals completion.
        if (completion.shouldComplete) {
          return !completion.shouldComplete(buildCompletionStatus()).complete;
        }

        // Default to fail-fast when no completion criteria are defined
        const hasAnyCompletionCriteria = Object.values(completion).some(
          (value) => value !== undefined,
        );
        if (!hasAnyCompletionCriteria) {
          return failureCount === 0;
        }

        if (
          completion.toleratedFailureCount !== undefined &&
          failureCount > completion.toleratedFailureCount
        )
          return false;

        if (completion.toleratedFailurePercentage !== undefined) {
          const failurePercentage = (failureCount / items.length) * 100;
          if (failurePercentage > completion.toleratedFailurePercentage)
            return false;
        }

        return true;
      };

      const isComplete = (): boolean => {
        // Always complete when all items are done (matches BatchResult inference)
        if (completedCount === items.length) {
          return true;
        }

        const completion = config.completionConfig;

        // A custom predicate takes precedence over minSuccessful.
        if (completion?.shouldComplete) {
          return completion.shouldComplete(buildCompletionStatus()).complete;
        }

        if (
          completion?.minSuccessful !== undefined &&
          successCount >= completion.minSuccessful
        ) {
          return true;
        }

        return false;
      };

      const getCompletionReason = (failureCount: number): CompletionReason => {
        return this.getCompletionReason(
          failureCount,
          successCount,
          completedCount,
          items,
          config,
          buildItemStatuses(),
        );
      };

      const tryStartNext = (): void => {
        while (
          activeCount < maxConcurrency &&
          currentIndex < items.length &&
          shouldContinue()
        ) {
          const index = currentIndex++;
          const item = items[index];

          startedItems.add(index);
          activeCount++;

          // Set STARTED status immediately in result array
          resultItems[index] = { index, status: BatchItemStatus.STARTED };

          log("▶️", `Starting ${this.operationName} item:`, {
            index,
            itemId: item.id,
            itemName: item.name,
          });

          parentContext
            .runInChildContext(
              item.name || item.id,
              (childContext) => executor(item, childContext),
              {
                subType: config.iterationSubType,
                serdes: config.itemSerdes,
                virtualContext: config.nesting === NestingType.FLAT,
              },
            )
            .then(
              (result) => {
                resultItems[index] = {
                  result,
                  index,
                  status: BatchItemStatus.SUCCEEDED,
                };
                successCount++;
                log("✅", `${this.operationName} item completed:`, {
                  index,
                  itemId: item.id,
                  itemName: item.name,
                });
                onComplete();
              },
              (error) => {
                const err =
                  error instanceof ChildContextError
                    ? error
                    : new ChildContextError(
                        error instanceof Error ? error.message : String(error),
                        error instanceof Error ? error : undefined,
                      );
                resultItems[index] = {
                  error: err,
                  index,
                  status: BatchItemStatus.FAILED,
                };
                failureCount++;
                log("❌", `${this.operationName} item failed:`, {
                  index,
                  itemId: item.id,
                  itemName: item.name,
                  error: err.message,
                });
                onComplete();
              },
            );
        }
      };

      const onComplete = (): void => {
        activeCount--;
        completedCount++;

        if (isComplete() || !shouldContinue()) {
          // Convert sparse array to dense array - items are already in correct order by index
          // Include all items that were started (have a value in resultItems)
          // Create shallow copy to prevent mutations from affecting the returned result
          const finalBatchItems: BatchItem<R>[] = [];
          for (let i = 0; i < resultItems.length; i++) {
            if (resultItems[i] !== undefined) {
              finalBatchItems.push({ ...resultItems[i]! });
            }
          }

          log("🎉", `${this.operationName} completed:`, {
            successCount,
            failureCount,
            startedCount: finalBatchItems.filter(
              (item) => item.status === BatchItemStatus.STARTED,
            ).length,
            totalCount: finalBatchItems.length,
          });

          const result = new BatchResultImpl(
            finalBatchItems,
            getCompletionReason(failureCount),
          );
          resolve(result);
        } else {
          tryStartNext();
        }
      };

      if (items.length === 0) {
        log("🎉", `${this.operationName} completed with no items`);
        resolve(new BatchResultImpl([], getCompletionReason(0)));
      } else {
        tryStartNext();
        // A custom shouldComplete predicate can signal completion before any
        // item is started (e.g. it returns true at zero progress). In that
        // case no item will ever call onComplete, so resolve here to avoid
        // hanging forever.
        if (activeCount === 0 && completedCount === 0) {
          resolve(new BatchResultImpl([], getCompletionReason(0)));
        }
      }
    });
  }
}

export const createConcurrentExecutionHandler = <Logger extends DurableLogger>(
  context: ExecutionContext,
  runInChildContext: DurableContext<Logger>["runInChildContext"],

  getDefaultSerdes?: () => AnySerdes,
) => {
  return <TItem, TResult>(
    nameOrItems: string | undefined | ConcurrentExecutionItem<TItem>[],
    itemsOrExecutor?:
      | ConcurrentExecutionItem<TItem>[]
      | ConcurrentExecutor<TItem, TResult, Logger>,
    executorOrConfig?:
      | ConcurrentExecutor<TItem, TResult, Logger>
      | ConcurrencyConfig<TResult>,
    maybeConfig?: ConcurrencyConfig<TResult>,
  ): DurablePromise<BatchResult<TResult>> => {
    // Phase 1: Start execution immediately
    const phase1Promise = (async (): Promise<BatchResult<TResult>> => {
      let name: string | undefined;
      let items: ConcurrentExecutionItem<TItem>[];
      let executor: ConcurrentExecutor<TItem, TResult, Logger>;
      let config: ConcurrencyConfig<TResult> | undefined;

      if (typeof nameOrItems === "string" || nameOrItems === undefined) {
        name = nameOrItems;
        items = itemsOrExecutor as ConcurrentExecutionItem<TItem>[];
        executor = executorOrConfig as ConcurrentExecutor<
          TItem,
          TResult,
          Logger
        >;
        config = maybeConfig;
      } else {
        items = nameOrItems;
        executor = itemsOrExecutor as ConcurrentExecutor<
          TItem,
          TResult,
          Logger
        >;
        config = executorOrConfig as ConcurrencyConfig<TResult>;
      }

      log("🔄", "Starting concurrent execution:", {
        name,
        itemCount: items.length,
        maxConcurrency: config?.maxConcurrency,
      });

      if (!Array.isArray(items)) {
        throw new Error("Concurrent execution requires an array of items");
      }

      if (typeof executor !== "function") {
        throw new Error("Concurrent execution requires an executor function");
      }

      if (
        config?.maxConcurrency !== undefined &&
        config.maxConcurrency !== null &&
        config.maxConcurrency <= 0
      ) {
        throw new Error(
          `Invalid maxConcurrency: ${config.maxConcurrency}. Must be a positive number or undefined for unlimited concurrency.`,
        );
      }

      // Mutually-exclusive completion config is a non-retryable configuration
      // error: terminate the execution rather than throwing. If it terminated,
      // stop here with a never-resolving promise so we don't proceed.
      if (
        !validateCompletionConfig(
          config?.completionConfig,
          context.terminationManager,
        )
      ) {
        return new Promise<BatchResult<TResult>>(() => {});
      }

      const executeOperation = async (
        executionContext: DurableContext<Logger>,
      ): Promise<BatchResult<TResult>> => {
        const concurrencyController = new ConcurrencyController<Logger>(
          "concurrent-execution",
          getDefaultSerdes,
        );

        // Access durableExecutionMode from the context - it's set by runInChildContext
        // based on determineChildReplayMode logic
        const durableExecutionMode = (
          executionContext as unknown as {
            durableExecutionMode: DurableExecutionMode;
          }
        ).durableExecutionMode;

        // Get the entity ID (step prefix) from the child context
        const entityId = (
          executionContext as unknown as {
            _stepPrefix?: string;
          }
        )._stepPrefix;

        log("🔄", "Concurrent execution mode:", {
          mode: durableExecutionMode,
          itemCount: items.length,
          entityId,
        });

        return await concurrencyController.executeItems(
          items,
          executor,
          executionContext,
          config || {},
          durableExecutionMode,
          entityId,
          context,
        );
      };

      const result = await runInChildContext(name, executeOperation, {
        subType: config?.topLevelSubType,
        summaryGenerator: config?.summaryGenerator,
        // Use BatchResult serdes to preserve Error types through serialization.
        serdes: config?.serdes || createBatchResultSerdes(),
      });

      // Restore BatchResult methods if the result came from deserialized data
      if (
        result &&
        typeof result === "object" &&
        "all" in result &&
        Array.isArray(result.all)
      ) {
        return restoreBatchResult<TResult>(result);
      }
      return result as BatchResult<TResult>;
    })();

    // Attach catch handler to prevent unhandled promise rejections
    // The error will still be thrown when the DurablePromise is awaited
    phase1Promise.catch(() => {});

    // Phase 2: Return DurablePromise that returns Phase 1 result when awaited
    return new DurablePromise(async () => {
      return await phase1Promise;
    });
  };
};
