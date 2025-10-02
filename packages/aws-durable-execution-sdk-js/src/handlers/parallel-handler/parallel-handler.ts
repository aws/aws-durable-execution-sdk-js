import {
  ExecutionContext,
  DurableContext,
  ParallelFunc,
  ParallelConfig,
  ConcurrentExecutionItem,
  ConcurrentExecutor,
  OperationSubType,
  NamedParallelBranch,
} from "../../types";
import { log } from "../../utils/logger/logger";
import { BatchResult } from "../concurrent-execution-handler/batch-result";
import { createParallelSummaryGenerator } from "../../utils/summary-generators";

export const createParallelHandler = (
  context: ExecutionContext,
  executeConcurrently: DurableContext["executeConcurrently"],
) => {
  return async <T>(
    nameOrBranches:
      | string
      | undefined
      | (ParallelFunc<T> | NamedParallelBranch<T>)[],
    branchesOrConfig?:
      | (ParallelFunc<T> | NamedParallelBranch<T>)[]
      | ParallelConfig,
    maybeConfig?: ParallelConfig,
  ): Promise<BatchResult<T>> => {
    let name: string | undefined;
    let branches: (ParallelFunc<T> | NamedParallelBranch<T>)[];
    let config: ParallelConfig | undefined;

    // Parse overloaded parameters
    if (typeof nameOrBranches === "string" || nameOrBranches === undefined) {
      // Case: parallel(name, branches, config?)
      name = nameOrBranches;
      branches = branchesOrConfig as (
        | ParallelFunc<T>
        | NamedParallelBranch<T>
      )[];
      config = maybeConfig;
    } else {
      // Case: parallel(branches, config?)
      branches = nameOrBranches;
      config = branchesOrConfig as ParallelConfig;
    }

    // Validate inputs
    if (!Array.isArray(branches)) {
      throw new Error(
        "Parallel operation requires an array of branch functions",
      );
    }

    log(context.isVerbose, "🔀", "Starting parallel operation:", {
      name,
      branchCount: branches.length,
      maxConcurrency: config?.maxConcurrency,
    });

    if (
      branches.some(
        (branch) =>
          typeof branch !== "function" &&
          (typeof branch !== "object" || typeof branch.func !== "function"),
      )
    ) {
      throw new Error(
        "All branches must be functions or NamedParallelBranch objects",
      );
    }

    // Convert to concurrent execution items
    const executionItems: ConcurrentExecutionItem<ParallelFunc<T>>[] =
      branches.map((branch, index) => {
        const isNamedBranch = typeof branch === "object" && "func" in branch;
        const func = isNamedBranch ? branch.func : branch;
        const branchName = isNamedBranch ? branch.name : undefined;

        return {
          id: `parallel-branch-${index}`,
          data: func,
          index,
          name: branchName,
        };
      });

    // Create executor that calls the branch function
    const executor: ConcurrentExecutor<ParallelFunc<T>, T> = async (
      executionItem,
      childContext,
    ) => {
      log(context.isVerbose, "🔀", "Processing parallel branch:", {
        index: executionItem.index,
      });

      const result = await executionItem.data(childContext);

      log(context.isVerbose, "✅", "Parallel branch completed:", {
        index: executionItem.index,
        result,
      });

      return result;
    };

    // Delegate to the concurrent execution handler
    const result = await executeConcurrently(name, executionItems, executor, {
      maxConcurrency: config?.maxConcurrency,
      topLevelSubType: OperationSubType.PARALLEL,
      iterationSubType: OperationSubType.PARALLEL_BRANCH,
      summaryGenerator: createParallelSummaryGenerator(),
      completionConfig: config?.completionConfig,
    });

    log(context.isVerbose, "🔀", "Parallel operation completed successfully:", {
      resultCount: result.totalCount,
    });

    return result;
  };
};
