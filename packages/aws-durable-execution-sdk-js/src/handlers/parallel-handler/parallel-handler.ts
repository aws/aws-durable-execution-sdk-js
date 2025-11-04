import {
  ExecutionContext,
  DurableContext,
  ParallelFunc,
  ParallelConfig,
  ConcurrentExecutionItem,
  OperationSubType,
  NamedParallelBranch,
  BatchResult,
} from "../../types";
import { log } from "../../utils/logger/logger";
import { createParallelSummaryGenerator } from "../../utils/summary-generators/summary-generators";

// Import the union type utility
type ExtractBranchReturnType<BranchType> = BranchType extends (
  context: DurableContext,
) => Promise<infer ReturnType>
  ? ReturnType
  : BranchType extends {
        name?: string;
        func: (context: DurableContext) => Promise<infer ReturnType>;
      }
    ? ReturnType
    : never;

type UnionFromBranches<BranchesArray extends readonly unknown[]> = {
  [BranchIndex in keyof BranchesArray]: ExtractBranchReturnType<
    BranchesArray[BranchIndex]
  >;
}[number];

type ParallelHandlerFunction = {
  // Enhanced overloads for automatic union type inference
  <BranchesArray extends readonly unknown[]>(
    name: string,
    branches: BranchesArray,
    config?: ParallelConfig<UnionFromBranches<BranchesArray>>,
  ): Promise<BatchResult<UnionFromBranches<BranchesArray>>>;

  <BranchesArray extends readonly unknown[]>(
    branches: BranchesArray,
    config?: ParallelConfig<UnionFromBranches<BranchesArray>>,
  ): Promise<BatchResult<UnionFromBranches<BranchesArray>>>;

  // Legacy overloads for backward compatibility
  <LegacyReturnType>(
    nameOrBranches:
      | string
      | undefined
      | (
          | ParallelFunc<LegacyReturnType>
          | NamedParallelBranch<LegacyReturnType>
        )[],
    branchesOrConfig?:
      | (
          | ParallelFunc<LegacyReturnType>
          | NamedParallelBranch<LegacyReturnType>
        )[]
      | ParallelConfig<LegacyReturnType>,
    maybeConfig?: ParallelConfig<LegacyReturnType>,
  ): Promise<BatchResult<LegacyReturnType>>;
};

export const createParallelHandler = (
  executionContext: ExecutionContext,
  executeConcurrently: DurableContext["executeConcurrently"],
): ParallelHandlerFunction => {
  // Implementation
  async function parallelHandler<BranchesOrReturnType>(
    nameOrBranches: string | undefined | BranchesOrReturnType,
    branchesOrConfig?:
      | BranchesOrReturnType
      | ParallelConfig<
          BranchesOrReturnType extends readonly unknown[]
            ? UnionFromBranches<BranchesOrReturnType>
            : BranchesOrReturnType
        >,
    maybeConfig?: ParallelConfig<
      BranchesOrReturnType extends readonly unknown[]
        ? UnionFromBranches<BranchesOrReturnType>
        : BranchesOrReturnType
    >,
  ): Promise<
    BatchResult<
      BranchesOrReturnType extends readonly unknown[]
        ? UnionFromBranches<BranchesOrReturnType>
        : BranchesOrReturnType
    >
  > {
    let name: string | undefined;
    let branches: BranchesOrReturnType;
    let config:
      | ParallelConfig<
          BranchesOrReturnType extends readonly unknown[]
            ? UnionFromBranches<BranchesOrReturnType>
            : BranchesOrReturnType
        >
      | undefined;

    // Parse overloaded parameters
    if (typeof nameOrBranches === "string" || nameOrBranches === undefined) {
      // Case: parallel(name, branches, config?)
      name = nameOrBranches as string | undefined;
      branches = branchesOrConfig as BranchesOrReturnType;
      config = maybeConfig;
    } else {
      // Case: parallel(branches, config?)
      branches = nameOrBranches;
      config = branchesOrConfig as ParallelConfig<
        BranchesOrReturnType extends readonly unknown[]
          ? UnionFromBranches<BranchesOrReturnType>
          : BranchesOrReturnType
      >;
    }

    // Validate inputs
    if (!Array.isArray(branches)) {
      throw new Error(
        "Parallel operation requires an array of branch functions",
      );
    }

    log("🔀", "Starting parallel operation:", {
      name,
      branchCount: (branches as readonly unknown[]).length,
      maxConcurrency: config?.maxConcurrency,
    });

    if (
      (branches as readonly unknown[]).some(
        (branch) =>
          typeof branch !== "function" &&
          (typeof branch !== "object" ||
            branch === null ||
            !("func" in branch) ||
            typeof (branch as { func: unknown }).func !== "function"),
      )
    ) {
      throw new Error(
        "All branches must be functions or NamedParallelBranch objects",
      );
    }

    // Convert to concurrent execution items
    const executionItems = (branches as readonly unknown[]).map(
      (branch, index) => {
        const isNamedBranch =
          typeof branch === "object" && branch !== null && "func" in branch;
        const func = isNamedBranch
          ? (branch as { func: ParallelFunc<unknown> }).func
          : (branch as ParallelFunc<unknown>);
        const branchName = isNamedBranch
          ? (branch as { name?: string }).name
          : undefined;

        return {
          id: `parallel-branch-${index}`,
          data: func,
          index,
          name: branchName,
        };
      },
    );

    // Create executor that calls the branch function
    type InferredResultType = BranchesOrReturnType extends readonly unknown[]
      ? UnionFromBranches<BranchesOrReturnType>
      : BranchesOrReturnType;

    const executor = async (
      executionItem: ConcurrentExecutionItem<ParallelFunc<unknown>>,
      childContext: DurableContext,
    ): Promise<InferredResultType> => {
      log("🔀", "Processing parallel branch:", {
        index: executionItem.index,
      });

      const result = await executionItem.data(childContext);

      log("✅", "Parallel branch completed:", {
        index: executionItem.index,
        result,
      });

      return result as InferredResultType;
    };

    // Delegate to the concurrent execution handler
    const result = await executeConcurrently<
      ParallelFunc<unknown>,
      InferredResultType
    >(name, executionItems, executor, {
      maxConcurrency: config?.maxConcurrency,
      topLevelSubType: OperationSubType.PARALLEL,
      iterationSubType: OperationSubType.PARALLEL_BRANCH,
      summaryGenerator: createParallelSummaryGenerator(),
      completionConfig: config?.completionConfig,
      serdes: config?.serdes,
      itemSerdes: config?.itemSerdes,
    });

    log("🔀", "Parallel operation completed successfully:", {
      resultCount: result.totalCount,
    });

    // Use type assertion to return the correct type
    return result as BatchResult<
      BranchesOrReturnType extends readonly unknown[]
        ? UnionFromBranches<BranchesOrReturnType>
        : BranchesOrReturnType
    >;
  }

  return parallelHandler;
};
