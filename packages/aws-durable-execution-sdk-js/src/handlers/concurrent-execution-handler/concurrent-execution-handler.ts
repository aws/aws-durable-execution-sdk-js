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
  DurablePromise,
  DurableLogger,
} from "../../types";
import { OperationStatus } from "@aws-sdk/client-lambda";
import { log } from "../../utils/logger/logger";
import { BatchResultImpl, restoreBatchResult } from "./batch-result";
import { defaultSerdes } from "../../utils/serdes/serdes";
import { ChildContextError } from "../../errors/durable-error/durable-error";

export class ConcurrencyController<Logger extends DurableLogger> {
  constructor(
    private readonly operationName: string,
    private readonly skipNextOperation: () => void,
  ) {}

  private isChildEntityCompleted(
    executionContext: ExecutionContext,
    parentEntityId: string,
    completedCount: number,
  ): boolean {
    const childEntityId = `${parentEntityId}-${completedCount + 1}`;
    const childStepData = executionContext.getStepData(childEntityId);

    return !!(
      childStepData &&
      (childStepData.Status === OperationStatus.SUCCEEDED ||
        childStepData.Status === OperationStatus.FAILED)
    );
  }

  private getCompletionReason<T, R>(
    failureCount: number,
    successCount: number,
    completedCount: number,
    items: ConcurrentExecutionItem<T>[],
    config: ConcurrencyConfig<R>,
  ): "ALL_COMPLETED" | "MIN_SUCCESSFUL_REACHED" | "FAILURE_TOLERANCE_EXCEEDED" {
    // Check tolerance first, before checking if all completed
    const completion = config.completionConfig;

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

      // Try to get the target count from step data
      let targetTotalCount: number | undefined;
      if (entityId && executionContext) {
        const stepData = executionContext.getStepData(entityId);
        const summaryPayload = stepData?.ContextDetails?.Result;

        if (summaryPayload) {
          try {
            const serdes = config.serdes || defaultSerdes;
            const parsedSummary = await serdes.deserialize(summaryPayload, {
              entityId: entityId,
              durableExecutionArn: executionContext.durableExecutionArn,
            });
            if (
              parsedSummary &&
              typeof parsedSummary === "object" &&
              "totalCount" in parsedSummary
            ) {
              // Read totalCount directly from summary metadata
              targetTotalCount = parsedSummary.totalCount as number;
              log("📊", "Found initial execution count:", {
                targetTotalCount,
              });
            }
          } catch (error) {
            log("⚠️", "Could not parse initial result summary:", error);
          }
        }
      }

      // If we have target count and required context, use optimized replay; otherwise fallback to concurrent execution
      if (targetTotalCount !== undefined && entityId && executionContext) {
        return await this.replayItems(
          items,
          executor,
          parentContext,
          config,
          targetTotalCount,
          executionContext,
          entityId,
        );
      } else {
        log(
          "⚠️",
          "No valid target count or context found, falling back to concurrent execution",
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

  private async replayItems<T, R>(
    items: ConcurrentExecutionItem<T>[],
    executor: ConcurrentExecutor<T, R, Logger>,
    parentContext: DurableContext<Logger>,
    config: ConcurrencyConfig<R>,
    targetTotalCount: number,
    executionContext: ExecutionContext,
    parentEntityId: string,
  ): Promise<BatchResult<R>> {
    const resultItems: Array<BatchItem<R>> = [];

    log("🔄", `Replaying ${items.length} items sequentially`, {
      targetTotalCount,
    });

    let completedCount = 0;
    let stepCounter = 0;

    // Replay items sequentially until we reach the target count
    for (const item of items) {
      // Stop if we've replayed all items that completed in initial execution
      if (completedCount >= targetTotalCount) {
        log("✅", "Reached target count, stopping replay", {
          completedCount,
          targetTotalCount,
        });
        break;
      }

      // Calculate the child entity ID that runInChildContext will create
      // It uses the parent's next step ID, which is parentEntityId-{counter}
      const childEntityId = `${parentEntityId}-${stepCounter + 1}`;

      if (
        !this.isChildEntityCompleted(
          executionContext,
          parentEntityId,
          stepCounter,
        )
      ) {
        log("⏭️", `Skipping incomplete item:`, {
          index: item.index,
          itemId: item.id,
          childEntityId,
        });
        // Increment step counter to maintain consistency
        this.skipNextOperation();
        stepCounter++;
        continue;
      }

      try {
        const result = await parentContext.runInChildContext(
          item.name || item.id,
          (childContext) => executor(item, childContext),
          { subType: config.iterationSubType, serdes: config.itemSerdes },
        );

        resultItems.push({
          result,
          index: item.index,
          status: BatchItemStatus.SUCCEEDED,
        });
        completedCount++;
        stepCounter++;

        log("✅", `Replayed ${this.operationName} item:`, {
          index: item.index,
          itemId: item.id,
          completedCount,
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
        completedCount++;
        stepCounter++;

        log("❌", `Replay failed for ${this.operationName} item:`, {
          index: item.index,
          itemId: item.id,
          error: err.message,
          completedCount,
        });
      }
    }

    log("🎉", `${this.operationName} replay completed:`, {
      completedCount,
      totalCount: resultItems.length,
    });

    const successCount = resultItems.filter(
      (item) => item.status === BatchItemStatus.SUCCEEDED,
    ).length;
    const failureCount = completedCount - successCount;

    return new BatchResultImpl(
      resultItems,
      this.getCompletionReason(
        failureCount,
        successCount,
        completedCount,
        items,
        config,
      ),
    );
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
      const shouldContinue = (): boolean => {
        const completion = config.completionConfig;
        if (!completion) return failureCount === 0;

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
        if (
          completion?.minSuccessful !== undefined &&
          successCount >= completion.minSuccessful
        ) {
          return true;
        }

        return false;
      };

      const getCompletionReason = (
        failureCount: number,
      ):
        | "ALL_COMPLETED"
        | "MIN_SUCCESSFUL_REACHED"
        | "FAILURE_TOLERANCE_EXCEEDED" => {
        return this.getCompletionReason(
          failureCount,
          successCount,
          completedCount,
          items,
          config,
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
              { subType: config.iterationSubType, serdes: config.itemSerdes },
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

      tryStartNext();
    });
  }
}

export const createConcurrentExecutionHandler = <Logger extends DurableLogger>(
  context: ExecutionContext,
  runInChildContext: DurableContext<Logger>["runInChildContext"],
  skipNextOperation: () => void,
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

      const executeOperation = async (
        executionContext: DurableContext<Logger>,
      ): Promise<BatchResult<TResult>> => {
        const concurrencyController = new ConcurrencyController<Logger>(
          "concurrent-execution",
          skipNextOperation,
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
        serdes: config?.serdes,
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
