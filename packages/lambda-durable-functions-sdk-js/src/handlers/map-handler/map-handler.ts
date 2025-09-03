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

export const createMapHandler = (
  context: ExecutionContext,
  executeConcurrently: DurableContext["executeConcurrently"],
) => {
  return async <T>(
    nameOrItems: string | undefined | any[],
    itemsOrMapFunc?: any[] | MapFunc<T>,
    mapFuncOrConfig?: MapFunc<T> | MapConfig,
    maybeConfig?: MapConfig,
  ): Promise<BatchResult<T>> => {
    let name: string | undefined;
    let items: any[];
    let mapFunc: MapFunc<T>;
    let config: MapConfig | undefined;

    // Parse overloaded parameters
    if (typeof nameOrItems === "string" || nameOrItems === undefined) {
      // Case: map(name, items, mapFunc, config?)
      name = nameOrItems;
      items = itemsOrMapFunc as any[];
      mapFunc = mapFuncOrConfig as MapFunc<T>;
      config = maybeConfig;
    } else {
      // Case: map(items, mapFunc, config?)
      items = nameOrItems;
      mapFunc = itemsOrMapFunc as MapFunc<T>;
      config = mapFuncOrConfig as MapConfig;
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
      }),
    );

    // Create executor that calls mapFunc
    const executor: ConcurrentExecutor<any, T> = async (
      executionItem,
      childContext,
    ) => mapFunc(childContext, executionItem.data, executionItem.index, items);

    // Delegate to the concurrent execution handler
    const result = await executeConcurrently(name, executionItems, executor, {
      maxConcurrency: config?.maxConcurrency,
      topLevelSubType: OperationSubType.MAP,
      iterationSubType: OperationSubType.MAP_ITERATION,
      completionConfig: config?.completionConfig,
    });

    log(context.isVerbose, "🗺️", "Map operation completed successfully:", {
      resultCount: result.totalCount,
    });

    return result;
  };
};
