import {
  ExecutionContext,
  MapFunc,
  MapConfig,
  ConcurrentExecutionItem,
  ConcurrentExecutor,
  ConcurrencyConfig,
  OperationSubType,
  BatchResult,
  DurablePromise,
  DurableLogger,
} from "../../types";
import { log } from "../../utils/logger/logger";
import { createMapSummaryGenerator } from "../../utils/summary-generators/summary-generators";

export const createMapHandler = <Logger extends DurableLogger>(
  context: ExecutionContext,
  executeConcurrently: <TItem, TResult>(
    name: string | undefined,
    items: ConcurrentExecutionItem<TItem>[],
    executor: ConcurrentExecutor<TItem, TResult, Logger>,
    config?: ConcurrencyConfig<TResult>,
  ) => DurablePromise<BatchResult<TResult>>,
) => {
  return <TInput, TOutput>(
    nameOrItems: string | undefined | TInput[],
    itemsOrMapFunc?: TInput[] | MapFunc<TInput, TOutput, Logger>,
    mapFuncOrConfig?:
      | MapFunc<TInput, TOutput, Logger>
      | MapConfig<TInput, TOutput>,
    maybeConfig?: MapConfig<TInput, TOutput>,
  ): DurablePromise<BatchResult<TOutput>> => {
    // Phase 1: Parse parameters and start execution immediately
    const phase1Promise = (async (): Promise<BatchResult<TOutput>> => {
      let name: string | undefined;
      let items: TInput[];
      let mapFunc: MapFunc<TInput, TOutput, Logger>;
      let config: MapConfig<TInput, TOutput> | undefined;

      // Parse overloaded parameters
      if (typeof nameOrItems === "string" || nameOrItems === undefined) {
        // Case: map(name, items, mapFunc, config?)
        name = nameOrItems;
        items = itemsOrMapFunc as TInput[];
        mapFunc = mapFuncOrConfig as MapFunc<TInput, TOutput, Logger>;
        config = maybeConfig;
      } else {
        // Case: map(items, mapFunc, config?)
        items = nameOrItems;
        mapFunc = itemsOrMapFunc as MapFunc<TInput, TOutput, Logger>;
        config = mapFuncOrConfig as MapConfig<TInput, TOutput>;
      }

      log("🗺️", "Starting map operation:", {
        name,
        itemCount: items.length,
        maxConcurrency: config?.maxConcurrency,
      });

      // Validate inputs
      if (!Array.isArray(items)) {
        throw new Error("Map operation requires an array of items");
      }

      if (typeof mapFunc !== "function") {
        throw new Error("Map operation requires a function to process items");
      }

      // Convert to concurrent execution items
      const executionItems: ConcurrentExecutionItem<TInput>[] = items.map(
        (item, index) => ({
          id: `map-item-${index}`,
          data: item,
          index,
          name: config?.itemNamer ? config.itemNamer(item, index) : undefined,
        }),
      );

      // Create executor that calls mapFunc
      const executor: ConcurrentExecutor<TInput, TOutput, Logger> = async (
        executionItem,
        childContext,
      ) =>
        mapFunc(childContext, executionItem.data, executionItem.index, items);

      const result = await executeConcurrently(name, executionItems, executor, {
        maxConcurrency: config?.maxConcurrency,
        topLevelSubType: OperationSubType.MAP,
        iterationSubType: OperationSubType.MAP_ITERATION,
        summaryGenerator: createMapSummaryGenerator(),
        completionConfig: config?.completionConfig,
        serdes: config?.serdes,
        itemSerdes: config?.itemSerdes,
      });

      log("🗺️", "Map operation completed successfully:", {
        resultCount: result.totalCount,
      });

      return result;
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
