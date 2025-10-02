import { ExecutionContext, DurableContext, BatchItemStatus } from "../../types";
import { log } from "../../utils/logger/logger";
import { BatchResult, BatchItem, BatchResultImpl } from "./batch-result";

/**
 * Represents an item to be executed with metadata for deterministic replay
 */
export interface ConcurrentExecutionItem<T> {
  id: string;
  data: T;
  index: number;
  name?: string;
}

/**
 * Configuration for concurrency control
 */
export interface ConcurrencyConfig {
  maxConcurrency?: number;
  topLevelSubType?: string;
  iterationSubType?: string;
  summaryGenerator?: (result: any) => string;
  completionConfig?: {
    minSuccessful?: number;
    toleratedFailureCount?: number;
    toleratedFailurePercentage?: number;
  };
}

/**
 * Executor function type for concurrent execution
 */
export type ConcurrentExecutor<TItem, TResult> = (
  item: ConcurrentExecutionItem<TItem>,
  childContext: DurableContext,
) => Promise<TResult>;

export class ConcurrencyController {
  constructor(
    private readonly isVerbose: boolean,
    private readonly operationName: string,
  ) {}

  async executeItems<T, R>(
    items: ConcurrentExecutionItem<T>[],
    executor: ConcurrentExecutor<T, R>,
    parentContext: DurableContext,
    config: ConcurrencyConfig,
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

    log(
      this.isVerbose,
      "🚀",
      `Starting ${this.operationName} with concurrency control:`,
      {
        itemCount: items.length,
        maxConcurrency,
      },
    );

    return new Promise<BatchResult<R>>((resolve) => {
      const shouldContinue = (): boolean => {
        const completion = config.completionConfig;
        if (!completion) return failureCount === 0;

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
        const completion = config.completionConfig;

        if (completedCount === items.length) {
          return (
            !completion ||
            failureCount === 0 ||
            (completion.minSuccessful !== undefined &&
              successCount >= completion.minSuccessful)
          );
        }

        if (
          completion?.minSuccessful !== undefined &&
          successCount >= completion.minSuccessful
        ) {
          return true;
        }

        return false;
      };

      const getCompletionReason = ():
        | "ALL_COMPLETED"
        | "MIN_SUCCESSFUL_REACHED"
        | "FAILURE_TOLERANCE_EXCEEDED" => {
        if (completedCount === items.length) return "ALL_COMPLETED";
        if (
          config.completionConfig?.minSuccessful !== undefined &&
          successCount >= config.completionConfig.minSuccessful
        )
          return "MIN_SUCCESSFUL_REACHED";
        return "FAILURE_TOLERANCE_EXCEEDED";
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

          log(this.isVerbose, "▶️", `Starting ${this.operationName} item:`, {
            index,
            itemId: item.id,
            itemName: item.name,
          });

          parentContext
            .runInChildContext(
              item.name || item.id,
              (childContext) => executor(item, childContext),
              { subType: config.iterationSubType },
            )
            .then(
              (result) => {
                resultItems[index] = {
                  result,
                  index,
                  status: BatchItemStatus.SUCCEEDED,
                };
                successCount++;
                log(
                  this.isVerbose,
                  "✅",
                  `${this.operationName} item completed:`,
                  {
                    index,
                    itemId: item.id,
                    itemName: item.name,
                  },
                );
                onComplete();
              },
              (error) => {
                const err =
                  error instanceof Error ? error : new Error(String(error));
                resultItems[index] = {
                  error: err,
                  index,
                  status: BatchItemStatus.FAILED,
                };
                failureCount++;
                log(
                  this.isVerbose,
                  "❌",
                  `${this.operationName} item failed:`,
                  {
                    index,
                    itemId: item.id,
                    itemName: item.name,
                    error: err.message,
                  },
                );
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
          const finalBatchItems: BatchItem<R>[] = [];
          for (let i = 0; i < resultItems.length; i++) {
            if (resultItems[i] !== undefined) {
              finalBatchItems.push(resultItems[i]!);
            }
          }

          log(this.isVerbose, "🎉", `${this.operationName} completed:`, {
            successCount,
            failureCount,
            startedCount: finalBatchItems.filter(
              (item) => item.status === BatchItemStatus.STARTED,
            ).length,
            totalCount: finalBatchItems.length,
          });

          const result = new BatchResultImpl(
            finalBatchItems,
            getCompletionReason(),
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

export const createConcurrentExecutionHandler = (
  context: ExecutionContext,
  runInChildContext: DurableContext["runInChildContext"],
) => {
  return async <TItem, TResult>(
    nameOrItems: string | undefined | ConcurrentExecutionItem<TItem>[],
    itemsOrExecutor?:
      | ConcurrentExecutionItem<TItem>[]
      | ConcurrentExecutor<TItem, TResult>,
    executorOrConfig?: ConcurrentExecutor<TItem, TResult> | ConcurrencyConfig,
    maybeConfig?: ConcurrencyConfig,
  ): Promise<BatchResult<TResult>> => {
    let name: string | undefined;
    let items: ConcurrentExecutionItem<TItem>[];
    let executor: ConcurrentExecutor<TItem, TResult>;
    let config: ConcurrencyConfig | undefined;

    if (typeof nameOrItems === "string" || nameOrItems === undefined) {
      name = nameOrItems;
      items = itemsOrExecutor as ConcurrentExecutionItem<TItem>[];
      executor = executorOrConfig as ConcurrentExecutor<TItem, TResult>;
      config = maybeConfig;
    } else {
      items = nameOrItems;
      executor = itemsOrExecutor as ConcurrentExecutor<TItem, TResult>;
      config = executorOrConfig as ConcurrencyConfig;
    }

    log(context.isVerbose, "🔄", "Starting concurrent execution:", {
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
      executionContext: DurableContext,
    ): Promise<BatchResult<TResult>> => {
      const concurrencyController = new ConcurrencyController(
        context.isVerbose,
        "concurrent-execution",
      );

      return await concurrencyController.executeItems(
        items,
        executor,
        executionContext,
        config || {},
      );
    };

    return await runInChildContext(name, executeOperation, {
      subType: config?.topLevelSubType,
      summaryGenerator: config?.summaryGenerator,
    });
  };
};
