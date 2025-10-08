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
  DurableExecutionMode,
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
import { OperationStatus } from "@aws-sdk/client-lambda";
import { createContextLoggerFactory } from "../../utils/logger/context-logger";
import { createDefaultLogger } from "../../utils/logger/default-logger";
import { createModeAwareLogger } from "../../utils/logger/mode-aware-logger";

export const createDurableContext = (
  executionContext: ExecutionContext,
  parentContext: Context,
  stepPrefix?: string,
  checkpointToken?: string,
  inheritedLogger?: Logger | null,
): DurableContext => {
  // Local logger state for this context instance
  let contextLogger: Logger | null = inheritedLogger || null;

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

  const getNextStepId = (): string => {
    const nextCounter = stepCounter + 1;
    return stepPrefix ? `${stepPrefix}-${nextCounter}` : `${nextCounter}`;
  };

  const checkAndUpdateReplayMode = (): void => {
    if (
      executionContext._durableExecutionMode === DurableExecutionMode.ReplayMode
    ) {
      const nextStepId = getNextStepId();
      const nextStepData = executionContext.getStepData(nextStepId);
      if (!nextStepData) {
        executionContext._durableExecutionMode =
          DurableExecutionMode.ExecutionMode;
      }
    }
  };

  const captureExecutionState = (): boolean => {
    const wasInReplayMode =
      executionContext._durableExecutionMode ===
      DurableExecutionMode.ReplayMode;
    const nextStepId = getNextStepId();
    const stepData = executionContext.getStepData(nextStepId);
    const wasNotFinished = !!(
      stepData &&
      stepData.Status !== OperationStatus.SUCCEEDED &&
      stepData.Status !== OperationStatus.FAILED
    );
    return wasInReplayMode && wasNotFinished;
  };

  const checkForNonResolvingPromise = (): Promise<never> | null => {
    if (
      executionContext._durableExecutionMode ===
      DurableExecutionMode.ReplaySucceededContext
    ) {
      const nextStepId = getNextStepId();
      const nextStepData = executionContext.getStepData(nextStepId);
      if (
        nextStepData &&
        nextStepData.Status !== OperationStatus.SUCCEEDED &&
        nextStepData.Status !== OperationStatus.FAILED
      ) {
        return new Promise<never>(() => {}); // Non-resolving promise
      }
    }
    return null;
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
    const shouldSwitchToExecutionMode = captureExecutionState();

    checkAndUpdateReplayMode();
    const nonResolvingPromise = checkForNonResolvingPromise();
    if (nonResolvingPromise) return nonResolvingPromise;

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
    try {
      return stepHandler(nameOrFn, fnOrOptions, maybeOptions);
    } finally {
      if (shouldSwitchToExecutionMode) {
        executionContext._durableExecutionMode =
          DurableExecutionMode.ExecutionMode;
      }
    }
  };

  const invoke: DurableContext["invoke"] = <I, O>(
    nameOrFuncId: string,
    funcIdOrInput?: string | I,
    inputOrConfig?: I | InvokeConfig<I, O>,
    maybeConfig?: InvokeConfig<I, O>,
  ) => {
    const shouldSwitchToExecutionMode = captureExecutionState();

    checkAndUpdateReplayMode();
    const nonResolvingPromise = checkForNonResolvingPromise();
    if (nonResolvingPromise) return nonResolvingPromise;

    const invokeHandler = createInvokeHandler(
      executionContext,
      checkpoint,
      createStepId,
      hasRunningOperations,
    );
    try {
      return invokeHandler<I, O>(
        ...([
          nameOrFuncId,
          funcIdOrInput,
          inputOrConfig,
          maybeConfig,
        ] as Parameters<typeof invokeHandler<I, O>>),
      );
    } finally {
      if (shouldSwitchToExecutionMode) {
        executionContext._durableExecutionMode =
          DurableExecutionMode.ExecutionMode;
      }
    }
  };

  const runInChildContext: DurableContext["runInChildContext"] = <T>(
    nameOrFn: string | undefined | ChildFunc<T>,
    fnOrOptions?: ChildFunc<T> | ChildConfig<T>,
    maybeOptions?: ChildConfig<T>,
  ) => {
    const shouldSwitchToExecutionMode = captureExecutionState();

    checkAndUpdateReplayMode();
    const nonResolvingPromise = checkForNonResolvingPromise();
    if (nonResolvingPromise) return nonResolvingPromise;

    const blockHandler = createRunInChildContextHandler(
      executionContext,
      checkpoint,
      parentContext,
      createStepId,
      getLogger,
    );
    try {
      return blockHandler(nameOrFn, fnOrOptions, maybeOptions);
    } finally {
      if (shouldSwitchToExecutionMode) {
        executionContext._durableExecutionMode =
          DurableExecutionMode.ExecutionMode;
      }
    }
  };

  const createCallback: DurableContext["createCallback"] = (
    nameOrConfig?: string | CreateCallbackConfig,
    maybeConfig?: CreateCallbackConfig,
  ) => {
    const shouldSwitchToExecutionMode = captureExecutionState();

    checkAndUpdateReplayMode();
    const nonResolvingPromise = checkForNonResolvingPromise();
    if (nonResolvingPromise) return nonResolvingPromise;

    const callbackFactory = createCallbackFactory(
      executionContext,
      checkpoint,
      createStepId,
      hasRunningOperations,
    );
    try {
      return callbackFactory(nameOrConfig, maybeConfig);
    } finally {
      if (shouldSwitchToExecutionMode) {
        executionContext._durableExecutionMode =
          DurableExecutionMode.ExecutionMode;
      }
    }
  };

  const waitForCallback: DurableContext["waitForCallback"] = (
    nameOrSubmitter?: string | undefined | WaitForCallbackSubmitterFunc,
    submitterOrConfig?: WaitForCallbackSubmitterFunc | WaitForCallbackConfig,
    maybeConfig?: WaitForCallbackConfig,
  ) => {
    const shouldSwitchToExecutionMode = captureExecutionState();

    checkAndUpdateReplayMode();
    const nonResolvingPromise = checkForNonResolvingPromise();
    if (nonResolvingPromise) return nonResolvingPromise;

    const waitForCallbackHandler = createWaitForCallbackHandler(
      executionContext,
      runInChildContext,
    );
    try {
      return waitForCallbackHandler(
        nameOrSubmitter!,
        submitterOrConfig,
        maybeConfig,
      );
    } finally {
      if (shouldSwitchToExecutionMode) {
        executionContext._durableExecutionMode =
          DurableExecutionMode.ExecutionMode;
      }
    }
  };

  const map: DurableContext["map"] = <TInput, TOutput>(
    nameOrItems: string | undefined | TInput[],
    itemsOrMapFunc: TInput[] | MapFunc<TInput, TOutput>,
    mapFuncOrConfig?: MapFunc<TInput, TOutput> | MapConfig<TInput>,
    maybeConfig?: MapConfig<TInput>,
  ) => {
    const shouldSwitchToExecutionMode = captureExecutionState();

    checkAndUpdateReplayMode();
    const nonResolvingPromise = checkForNonResolvingPromise();
    if (nonResolvingPromise) return nonResolvingPromise;

    const mapHandler = createMapHandler(executionContext, executeConcurrently);
    try {
      return mapHandler(
        nameOrItems,
        itemsOrMapFunc,
        mapFuncOrConfig,
        maybeConfig,
      );
    } finally {
      if (shouldSwitchToExecutionMode) {
        executionContext._durableExecutionMode =
          DurableExecutionMode.ExecutionMode;
      }
    }
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
    const shouldSwitchToExecutionMode = captureExecutionState();

    checkAndUpdateReplayMode();
    const nonResolvingPromise = checkForNonResolvingPromise();
    if (nonResolvingPromise) return nonResolvingPromise;

    const parallelHandler = createParallelHandler(
      executionContext,
      executeConcurrently,
    );
    try {
      return parallelHandler(nameOrBranches, branchesOrConfig, maybeConfig);
    } finally {
      if (shouldSwitchToExecutionMode) {
        executionContext._durableExecutionMode =
          DurableExecutionMode.ExecutionMode;
      }
    }
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
    const shouldSwitchToExecutionMode = captureExecutionState();

    checkAndUpdateReplayMode();
    const nonResolvingPromise = checkForNonResolvingPromise();
    if (nonResolvingPromise) return nonResolvingPromise;

    const concurrentExecutionHandler = createConcurrentExecutionHandler(
      executionContext,
      runInChildContext,
    );
    try {
      return concurrentExecutionHandler(
        nameOrItems,
        itemsOrExecutor,
        executorOrConfig,
        maybeConfig,
      );
    } finally {
      if (shouldSwitchToExecutionMode) {
        executionContext._durableExecutionMode =
          DurableExecutionMode.ExecutionMode;
      }
    }
  };

  const promise = createPromiseHandler(step);

  const setCustomLogger = (logger: Logger): void => {
    contextLogger = logger;
  };

  const wait: DurableContext["wait"] = (
    nameOrMillis: string | number,
    maybeMillis?: number,
  ) => {
    const shouldSwitchToExecutionMode = captureExecutionState();

    checkAndUpdateReplayMode();
    const nonResolvingPromise = checkForNonResolvingPromise();
    if (nonResolvingPromise) return nonResolvingPromise;

    const waitHandler = createWaitHandler(
      executionContext,
      checkpoint,
      createStepId,
      hasRunningOperations,
    );
    try {
      return waitHandler(nameOrMillis as any, maybeMillis as any);
    } finally {
      if (shouldSwitchToExecutionMode) {
        executionContext._durableExecutionMode =
          DurableExecutionMode.ExecutionMode;
      }
    }
  };

  const waitForConditionHandler = createWaitForConditionHandler(
    executionContext,
    checkpoint,
    createStepId,
    createContextLogger,
    addRunningOperation,
    removeRunningOperation,
    hasRunningOperations,
  );

  const waitForCondition: DurableContext["waitForCondition"] = <T>(
    nameOrCheckFunc: string | undefined | any,
    checkFuncOrConfig?: any,
    maybeConfig?: any,
  ) => {
    const shouldSwitchToExecutionMode = captureExecutionState();

    checkAndUpdateReplayMode();
    const nonResolvingPromise = checkForNonResolvingPromise();
    if (nonResolvingPromise) return nonResolvingPromise;

    try {
      return waitForConditionHandler(
        nameOrCheckFunc,
        checkFuncOrConfig,
        maybeConfig,
      );
    } finally {
      if (shouldSwitchToExecutionMode) {
        executionContext._durableExecutionMode =
          DurableExecutionMode.ExecutionMode;
      }
    }
  };

  const durableContext = {
    ...parentContext,
    _stepPrefix: stepPrefix,
    _stepCounter: stepCounter,
    _durableExecutionMode: executionContext._durableExecutionMode,
    get logger(): Logger {
      return createModeAwareLogger(
        executionContext,
        createContextLogger,
        stepPrefix,
      );
    },
    step,
    invoke,
    runInChildContext,
    wait,
    waitForCondition,
    createCallback,
    waitForCallback,
    map,
    parallel,
    executeConcurrently,
    promise,
    setCustomLogger,
  };

  return durableContext as DurableContext;
};
