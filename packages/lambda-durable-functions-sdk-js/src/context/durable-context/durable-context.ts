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
  ConcurrentExecutionItem,
  ConcurrentExecutor,
  ConcurrencyConfig,
  Logger,
} from "../../types";
import { Context } from "aws-lambda";
import { createCheckpoint } from "../../utils/checkpoint/checkpoint";
import { createStepHandler } from "../../handlers/step-handler/step-handler";
import { createRunInChildContextHandler } from "../../handlers/run-in-child-context-handler/run-in-child-context-handler";
import { createWaitHandler } from "../../handlers/wait-handler/wait-handler";
import { createWaitForConditionHandler } from "../../handlers/wait-for-condition-handler/wait-for-condition-handler";
import { createCallback as createCallbackFactory } from "../../handlers/callback-handler/callback";
import { createWaitForCallbackHandler } from "../../handlers/wait-for-callback-handler/wait-for-callback-handler";
import { createMapHandler } from "../../handlers/map-handler/map-handler";
import { createParallelHandler } from "../../handlers/parallel-handler/parallel-handler";
import { createPromiseHandler } from "../../handlers/promise-handler/promise-handler";
import { createConcurrentExecutionHandler } from "../../handlers/concurrent-execution-handler/concurrent-execution-handler";
import { setCustomLogger } from "../../utils/logger/structured-logger";

export const createDurableContext = (
  executionContext: ExecutionContext,
  parentContext: Context,
  stepPrefix?: string,
  checkpointToken?: string,
): DurableContext => {
  let stepCounter = 0;
  const checkpoint = createCheckpoint(executionContext, checkpointToken || "");

  const createStepId = (): string => {
    stepCounter++;
    return stepPrefix ? `${stepPrefix}-${stepCounter}` : `${stepCounter}`;
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
    );
    return stepHandler(nameOrFn, fnOrOptions, maybeOptions);
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

  const map: DurableContext["map"] = <T>(
    nameOrItems: string | undefined | any[],
    itemsOrMapFunc?: any[] | MapFunc<T>,
    mapFuncOrConfig?: MapFunc<T> | MapConfig,
    maybeConfig?: MapConfig,
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
    nameOrBranches: string | undefined | ParallelFunc<T>[],
    branchesOrConfig?: ParallelFunc<T>[] | ParallelConfig,
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

  const configureLogger = (logger: Logger): void => {
    setCustomLogger(logger);
  };

  return {
    ...parentContext,
    _stepPrefix: stepPrefix,
    _stepCounter: stepCounter,
    step,
    runInChildContext,
    wait: createWaitHandler(executionContext, checkpoint, createStepId),
    waitForCondition: createWaitForConditionHandler(
      executionContext,
      checkpoint,
      createStepId,
    ),
    createCallback,
    waitForCallback,
    map,
    parallel,
    executeConcurrently,
    promise,
    configureLogger,
  };
};
