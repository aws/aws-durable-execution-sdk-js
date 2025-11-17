import {
  ExecutionContext,
  MapFunc,
  MapConfig,
  ConcurrentExecutionItem,
  ConcurrentExecutor,
  ConcurrencyConfig,
  OperationSubType,
  BatchResult,
} from "../../types";
import { log } from "../../utils/logger/logger";
import { createMapSummaryGenerator } from "../../utils/summary-generators/summary-generators";

export const createMapHandler = (
  context: ExecutionContext,
  executeConcurrently: <TItem, TResult>(
    name: string | undefined,
    items: ConcurrentExecutionItem<TItem>[],
    executor: ConcurrentExecutor<TItem, TResult>,
    config?: ConcurrencyConfig<TResult>,
  ) => Promise<BatchResult<TResult>>,
) => {
  return async <TInput, TOutput>(
    nameOrItems: string | undefined | TInput[],
    itemsOrMapFunc?: TInput[] | MapFunc<TInput, TOutput>,
    mapFuncOrConfig?: MapFunc<TInput, TOutput> | MapConfig<TInput, TOutput>,
    maybeConfig?: MapConfig<TInput, TOutput>,
  ): Promise<BatchResult<TOutput>> => {
    let name: string | undefined;
    let items: TInput[];
    let mapFunc: MapFunc<TInput, TOutput>;
    let config: MapConfig<TInput, TOutput> | undefined;

    // Parse overloaded parameters
    if (typeof nameOrItems === "string" || nameOrItems === undefined) {
      // Case: map(name, items, mapFunc, config?)
      name = nameOrItems;
      items = itemsOrMapFunc as TInput[];
      mapFunc = mapFuncOrConfig as MapFunc<TInput, TOutput>;
      config = maybeConfig;
    } else {
      // Case: map(items, mapFunc, config?)
      items = nameOrItems;
      mapFunc = itemsOrMapFunc as MapFunc<TInput, TOutput>;
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
    const executor: ConcurrentExecutor<TInput, TOutput> = async (
      executionItem,
      childContext,
    ) => mapFunc(childContext, executionItem.data, executionItem.index, items);

    // Delegate to the concurrent execution handler
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
  };
};
