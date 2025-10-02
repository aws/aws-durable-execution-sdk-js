import {
  ExecutionContext,
  DurableContext,
  StepFunc,
  StepConfig,
  ChildFunc,
  ChildConfig,
  CreateCallbackConfig,
  WaitForCallbackSubmitterFunc,
  WaitForCallbackConfig,
  MapFunc,
  MapConfig,
  ParallelFunc,
  ParallelConfig,
  NamedParallelBranch,
  ConcurrentExecutionItem,
  ConcurrentExecutor,
  ConcurrencyConfig,
  Logger,
  InvokeConfig,
} from "../../types";
import { Context } from "aws-lambda";
import { createCheckpoint } from "../../utils/checkpoint/checkpoint";
import { createStepHandler } from "../../handlers/step-handler/step-handler";
import { createInvokeHandler } from "../../handlers/invoke-handler/invoke-handler";
import { createRunInChildContextHandler } from "../../handlers/run-in-child-context-handler/run-in-child-context-handler";
import { createWaitHandler } from "../../handlers/wait-handler/wait-handler";
import { createWaitForConditionHandler } from "../../handlers/wait-for-condition-handler/wait-for-condition-handler";
import { createCallback as createCallbackFactory } from "../../handlers/callback-handler/callback";
import { createWaitForCallbackHandler } from "../../handlers/wait-for-callback-handler/wait-for-callback-handler";
import { createMapHandler } from "../../handlers/map-handler/map-handler";
import { createParallelHandler } from "../../handlers/parallel-handler/parallel-handler";
import { createPromiseHandler } from "../../handlers/promise-handler/promise-handler";
import { createConcurrentExecutionHandler } from "../../handlers/concurrent-execution-handler/concurrent-execution-handler";
import { createContextLoggerFactory } from "../../utils/logger/context-logger";
import { createDefaultLogger } from "../../utils/logger/default-logger";

export const createDurableContext = (
  executionContext: ExecutionContext,
  parentContext: Context,
  stepPrefix?: string,
  checkpointToken?: string,
): DurableContext => {
  // Local logger state for this context instance
  let contextLogger: Logger | null = null;

  // Local getter function for this context
  const getLogger = (): Logger => {
    return contextLogger || createDefaultLogger();
  };

  // Create context logger factory
  const createContextLogger = createContextLoggerFactory(
    executionContext,
    getLogger,
  );

  let stepCounter = 0;
  const runningOperations = new Set<string>();
  const checkpoint = createCheckpoint(executionContext, checkpointToken || "");

  const createStepId = (): string => {
    stepCounter++;
    return stepPrefix ? `${stepPrefix}-${stepCounter}` : `${stepCounter}`;
  };

  // Internal helpers for managing running operations
  const addRunningOperation = (stepId: string): void => {
    runningOperations.add(stepId);
  };

  const removeRunningOperation = (stepId: string): void => {
    runningOperations.delete(stepId);
  };

  const hasRunningOperations = (): boolean => {
    return runningOperations.size > 0;
  };

  const step: DurableContext["step"] = <T>(
    nameOrFn: string | undefined | StepFunc<T>,
    fnOrOptions?: StepFunc<T> | StepConfig<T>,
    maybeOptions?: StepConfig<T>,
  ) => {
    const stepHandler = createStepHandler(
      executionContext,
      checkpoint,
      parentContext,
      createStepId,
      createContextLogger,
      addRunningOperation,
      removeRunningOperation,
      hasRunningOperations,
    );
    return stepHandler(nameOrFn, fnOrOptions, maybeOptions);
  };

  const invoke: DurableContext["invoke"] = <I, O>(
    nameOrFuncId: string,
    funcIdOrInput?: string | I,
    inputOrConfig?: I | InvokeConfig<I, O>,
    maybeConfig?: InvokeConfig<I, O>,
  ) => {
    const invokeHandler = createInvokeHandler(
      executionContext,
      checkpoint,
      createStepId,
      hasRunningOperations,
    );
    return invokeHandler<I, O>(
      nameOrFuncId,
      funcIdOrInput as any,
      inputOrConfig as any,
      maybeConfig,
    );
  };

  const runInChildContext: DurableContext["runInChildContext"] = <T>(
    nameOrFn: string | undefined | ChildFunc<T>,
    fnOrOptions?: ChildFunc<T> | ChildConfig<T>,
    maybeOptions?: ChildConfig<T>,
  ) => {
    const blockHandler = createRunInChildContextHandler(
      executionContext,
      checkpoint,
      parentContext,
      createStepId,
    );
    return blockHandler(nameOrFn, fnOrOptions, maybeOptions);
  };

  const createCallback: DurableContext["createCallback"] = (
    nameOrConfig?: string | CreateCallbackConfig,
    maybeConfig?: CreateCallbackConfig,
  ) => {
    const callbackFactory = createCallbackFactory(
      executionContext,
      checkpoint,
      createStepId,
      hasRunningOperations,
    );
    return callbackFactory(nameOrConfig, maybeConfig);
  };

  const waitForCallback: DurableContext["waitForCallback"] = (
    nameOrSubmitter?: string | undefined | WaitForCallbackSubmitterFunc,
    submitterOrConfig?: WaitForCallbackSubmitterFunc | WaitForCallbackConfig,
    maybeConfig?: WaitForCallbackConfig,
  ) => {
    const waitForCallbackHandler = createWaitForCallbackHandler(
      executionContext,
      runInChildContext,
    );
    return waitForCallbackHandler(
      nameOrSubmitter!,
      submitterOrConfig,
      maybeConfig,
    );
  };

  const map: DurableContext["map"] = <TInput, TOutput>(
    nameOrItems: string | undefined | TInput[],
    itemsOrMapFunc: TInput[] | MapFunc<TInput, TOutput>,
    mapFuncOrConfig?: MapFunc<TInput, TOutput> | MapConfig<TInput>,
    maybeConfig?: MapConfig<TInput>,
  ) => {
    const mapHandler = createMapHandler(executionContext, executeConcurrently);
    return mapHandler(
      nameOrItems,
      itemsOrMapFunc,
      mapFuncOrConfig,
      maybeConfig,
    );
  };

  const parallel: DurableContext["parallel"] = <T>(
    nameOrBranches:
      | string
      | undefined
      | (ParallelFunc<T> | NamedParallelBranch<T>)[],
    branchesOrConfig?:
      | (ParallelFunc<T> | NamedParallelBranch<T>)[]
      | ParallelConfig,
    maybeConfig?: ParallelConfig,
  ) => {
    const parallelHandler = createParallelHandler(
      executionContext,
      executeConcurrently,
    );
    return parallelHandler(nameOrBranches, branchesOrConfig, maybeConfig);
  };

  const executeConcurrently: DurableContext["executeConcurrently"] = <
    TItem,
    TResult,
  >(
    nameOrItems: string | undefined | ConcurrentExecutionItem<TItem>[],
    itemsOrExecutor?:
      | ConcurrentExecutionItem<TItem>[]
      | ConcurrentExecutor<TItem, TResult>,
    executorOrConfig?: ConcurrentExecutor<TItem, TResult> | ConcurrencyConfig,
    maybeConfig?: ConcurrencyConfig,
  ) => {
    const concurrentExecutionHandler = createConcurrentExecutionHandler(
      executionContext,
      runInChildContext,
    );
    return concurrentExecutionHandler(
      nameOrItems,
      itemsOrExecutor,
      executorOrConfig,
      maybeConfig,
    );
  };

  const promise = createPromiseHandler(step);

  const setCustomLogger = (logger: Logger): void => {
    contextLogger = logger;
  };

  return {
    ...parentContext,
    _stepPrefix: stepPrefix,
    _stepCounter: stepCounter,
    step,
    invoke,
    runInChildContext,
    wait: createWaitHandler(
      executionContext,
      checkpoint,
      createStepId,
      hasRunningOperations,
    ),
    waitForCondition: createWaitForConditionHandler(
      executionContext,
      checkpoint,
      createStepId,
      createContextLogger,
      addRunningOperation,
      removeRunningOperation,
      hasRunningOperations,
    ),
    createCallback,
    waitForCallback,
    map,
    parallel,
    executeConcurrently,
    promise,
    setCustomLogger,
  };
};
