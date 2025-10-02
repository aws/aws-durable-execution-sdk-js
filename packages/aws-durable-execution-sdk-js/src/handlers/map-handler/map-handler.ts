import {
  ExecutionContext,
  DurableContext,
  MapFunc,
  MapConfig,
  ConcurrentExecutionItem,
  ConcurrentExecutor,
  OperationSubType,
} from "../../types";
import { log } from "../../utils/logger/logger";
import { BatchResult } from "../concurrent-execution-handler/batch-result";
import { createMapSummaryGenerator } from "../../utils/summary-generators";

export const createMapHandler = (
  context: ExecutionContext,
  executeConcurrently: DurableContext["executeConcurrently"],
) => {
  return async <TInput, TOutput>(
    nameOrItems: string | undefined | TInput[],
    itemsOrMapFunc?: TInput[] | MapFunc<TInput, TOutput>,
    mapFuncOrConfig?: MapFunc<TInput, TOutput> | MapConfig<TInput>,
    maybeConfig?: MapConfig<TInput>,
  ): Promise<BatchResult<TOutput>> => {
    let name: string | undefined;
    let items: TInput[];
    let mapFunc: MapFunc<TInput, TOutput>;
    let config: MapConfig<TInput> | undefined;

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
      config = mapFuncOrConfig as MapConfig<TInput>;
    }

    log(context.isVerbose, "🗺️", "Starting map operation:", {
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
    const executionItems: ConcurrentExecutionItem<any>[] = items.map(
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
    });

    log(context.isVerbose, "🗺️", "Map operation completed successfully:", {
      resultCount: result.totalCount,
    });

    return result;
  };
};
