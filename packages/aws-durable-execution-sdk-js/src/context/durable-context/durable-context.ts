import {
  ExecutionContext,
  DurableContext,
  StepFunc,
  StepConfig,
  ChildFunc,
  ChildConfig,
  CreateCallbackConfig,
  CreateCallbackResult,
  WaitForCallbackSubmitterFunc,
  WaitForCallbackConfig,
  WaitForConditionCheckFunc,
  WaitForConditionConfig,
  MapFunc,
  MapConfig,
  Duration,
  ParallelFunc,
  ParallelConfig,
  NamedParallelBranch,
  ConcurrentExecutionItem,
  ConcurrentExecutor,
  ConcurrencyConfig,
  Logger,
  InvokeConfig,
  DurableExecutionMode,
  BatchResult,
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
import { EventEmitter } from "events";
import { OPERATIONS_COMPLETE_EVENT } from "../../utils/constants/constants";
import { validateContextUsage } from "../../utils/context-tracker/context-tracker";

class DurableContextImpl implements DurableContext {
  private _stepPrefix?: string;
  private _stepCounter: number = 0;
  private contextLogger: Logger | null;
  private runningOperations = new Set<string>();
  private operationsEmitter = new EventEmitter();
  private checkpoint: ReturnType<typeof createCheckpoint>;
  private createContextLogger: ReturnType<typeof createContextLoggerFactory>;
  private durableExecutionMode: DurableExecutionMode;
  private _parentId?: string;

  constructor(
    private executionContext: ExecutionContext,
    public lambdaContext: Context,
    durableExecutionMode: DurableExecutionMode,
    stepPrefix?: string,
    checkpointToken?: string,
    inheritedLogger?: Logger | null,
    parentId?: string,
  ) {
    this._stepPrefix = stepPrefix;
    this._parentId = parentId;
    this.contextLogger = inheritedLogger || null;
    this.checkpoint = createCheckpoint(
      executionContext,
      checkpointToken || "",
      this.operationsEmitter,
    );
    this.durableExecutionMode = durableExecutionMode;

    const getLogger = (): Logger => {
      return this.contextLogger || createDefaultLogger();
    };

    this.createContextLogger = createContextLoggerFactory(
      executionContext,
      getLogger,
    );
  }

  get logger(): Logger {
    return createModeAwareLogger(
      this.durableExecutionMode,
      this.createContextLogger,
      this._stepPrefix,
    );
  }

  private createStepId(): string {
    this._stepCounter++;
    return this._stepPrefix
      ? `${this._stepPrefix}-${this._stepCounter}`
      : `${this._stepCounter}`;
  }

  private getNextStepId(): string {
    const nextCounter = this._stepCounter + 1;
    return this._stepPrefix
      ? `${this._stepPrefix}-${nextCounter}`
      : `${nextCounter}`;
  }

  /**
   * Skips the next operation by incrementing the step counter.
   * Used internally by concurrent execution handler during replay to skip incomplete items.
   * @internal
   */
  private skipNextOperation(): void {
    this._stepCounter++;
  }

  private checkAndUpdateReplayMode(): void {
    if (this.durableExecutionMode === DurableExecutionMode.ReplayMode) {
      const nextStepId = this.getNextStepId();
      const nextStepData = this.executionContext.getStepData(nextStepId);
      if (!nextStepData) {
        this.durableExecutionMode = DurableExecutionMode.ExecutionMode;
      }
    }
  }

  private captureExecutionState(): boolean {
    const wasInReplayMode =
      this.durableExecutionMode === DurableExecutionMode.ReplayMode;
    const nextStepId = this.getNextStepId();
    const stepData = this.executionContext.getStepData(nextStepId);
    const wasNotFinished = !!(
      stepData &&
      stepData.Status !== OperationStatus.SUCCEEDED &&
      stepData.Status !== OperationStatus.FAILED
    );
    return wasInReplayMode && wasNotFinished;
  }

  private checkForNonResolvingPromise(): Promise<never> | null {
    if (
      this.durableExecutionMode === DurableExecutionMode.ReplaySucceededContext
    ) {
      const nextStepId = this.getNextStepId();
      const nextStepData = this.executionContext.getStepData(nextStepId);
      if (
        nextStepData &&
        nextStepData.Status !== OperationStatus.SUCCEEDED &&
        nextStepData.Status !== OperationStatus.FAILED
      ) {
        return new Promise<never>(() => {}); // Non-resolving promise
      }
    }
    return null;
  }

  private addRunningOperation(stepId: string): void {
    this.runningOperations.add(stepId);
  }

  private removeRunningOperation(stepId: string): void {
    this.runningOperations.delete(stepId);
    if (this.runningOperations.size === 0) {
      this.operationsEmitter.emit(OPERATIONS_COMPLETE_EVENT);
    }
  }

  private hasRunningOperations(): boolean {
    return this.runningOperations.size > 0;
  }

  private getOperationsEmitter(): EventEmitter {
    return this.operationsEmitter;
  }

  private withModeManagement<T>(operation: () => Promise<T>): Promise<T> {
    const shouldSwitchToExecutionMode = this.captureExecutionState();

    this.checkAndUpdateReplayMode();
    const nonResolvingPromise = this.checkForNonResolvingPromise();
    if (nonResolvingPromise) return nonResolvingPromise;

    try {
      return operation();
    } finally {
      if (shouldSwitchToExecutionMode) {
        this.durableExecutionMode = DurableExecutionMode.ExecutionMode;
      }
    }
  }

  step<T>(
    nameOrFn: string | undefined | StepFunc<T>,
    fnOrOptions?: StepFunc<T> | StepConfig<T>,
    maybeOptions?: StepConfig<T>,
  ): Promise<T> {
    validateContextUsage(
      this._stepPrefix,
      "step",
      this.executionContext.terminationManager,
    );

    return this.withModeManagement(() => {
      const stepHandler = createStepHandler(
        this.executionContext,
        this.checkpoint,
        this.lambdaContext,
        this.createStepId.bind(this),
        this.createContextLogger,
        this.addRunningOperation.bind(this),
        this.removeRunningOperation.bind(this),
        this.hasRunningOperations.bind(this),
        this.getOperationsEmitter.bind(this),
        this._parentId,
      );
      const promise = stepHandler(nameOrFn, fnOrOptions, maybeOptions);
      // Prevent unhandled promise rejections
      promise?.catch(() => {});
      return promise;
    });
  }

  invoke<I, O>(
    nameOrFuncId: string,
    funcIdOrInput?: string | I,
    inputOrConfig?: I | InvokeConfig<I, O>,
    maybeConfig?: InvokeConfig<I, O>,
  ): Promise<O> {
    validateContextUsage(
      this._stepPrefix,
      "invoke",
      this.executionContext.terminationManager,
    );
    return this.withModeManagement(() => {
      const invokeHandler = createInvokeHandler(
        this.executionContext,
        this.checkpoint,
        this.createStepId.bind(this),
        this.hasRunningOperations.bind(this),
        this.getOperationsEmitter.bind(this),
        this._parentId,
      );
      const promise = invokeHandler<I, O>(
        ...([
          nameOrFuncId,
          funcIdOrInput,
          inputOrConfig,
          maybeConfig,
        ] as Parameters<typeof invokeHandler<I, O>>),
      );
      // Prevent unhandled promise rejections
      promise?.catch(() => {});
      return promise;
    });
  }

  runInChildContext<T>(
    nameOrFn: string | undefined | ChildFunc<T>,
    fnOrOptions?: ChildFunc<T> | ChildConfig<T>,
    maybeOptions?: ChildConfig<T>,
  ): Promise<T> {
    validateContextUsage(
      this._stepPrefix,
      "runInChildContext",
      this.executionContext.terminationManager,
    );
    return this.withModeManagement(() => {
      const blockHandler = createRunInChildContextHandler(
        this.executionContext,
        this.checkpoint,
        this.lambdaContext,
        this.createStepId.bind(this),
        () => this.contextLogger || createDefaultLogger(),
        createDurableContext,
        this._parentId,
      );
      const promise = blockHandler(nameOrFn, fnOrOptions, maybeOptions);
      // Prevent unhandled promise rejections
      promise?.catch(() => {});
      return promise;
    });
  }

  wait(
    nameOrDuration: string | Duration,
    maybeDuration?: Duration,
  ): Promise<void> {
    validateContextUsage(
      this._stepPrefix,
      "wait",
      this.executionContext.terminationManager,
    );
    return this.withModeManagement(() => {
      const waitHandler = createWaitHandler(
        this.executionContext,
        this.checkpoint,
        this.createStepId.bind(this),
        this.hasRunningOperations.bind(this),
        this.getOperationsEmitter.bind(this),
        this._parentId,
      );
      const promise =
        typeof nameOrDuration === "string"
          ? waitHandler(nameOrDuration, maybeDuration!)
          : waitHandler(nameOrDuration);
      // Prevent unhandled promise rejections
      promise?.catch(() => {});
      return promise;
    });
  }

  setCustomLogger(logger: Logger): void {
    this.contextLogger = logger;
  }

  createCallback<T>(
    nameOrConfig?: string | CreateCallbackConfig<T>,
    maybeConfig?: CreateCallbackConfig<T>,
  ): Promise<CreateCallbackResult<T>> {
    validateContextUsage(
      this._stepPrefix,
      "createCallback",
      this.executionContext.terminationManager,
    );
    return this.withModeManagement(() => {
      const callbackFactory = createCallbackFactory(
        this.executionContext,
        this.checkpoint,
        this.createStepId.bind(this),
        this.hasRunningOperations.bind(this),
        this.getOperationsEmitter.bind(this),
        this._parentId,
      );
      const promise = callbackFactory(nameOrConfig, maybeConfig);
      // Prevent unhandled promise rejections
      promise?.catch(() => {});
      return promise;
    });
  }

  waitForCallback<T>(
    nameOrSubmitter?: string | undefined | WaitForCallbackSubmitterFunc,
    submitterOrConfig?: WaitForCallbackSubmitterFunc | WaitForCallbackConfig<T>,
    maybeConfig?: WaitForCallbackConfig<T>,
  ): Promise<T> {
    validateContextUsage(
      this._stepPrefix,
      "waitForCallback",
      this.executionContext.terminationManager,
    );
    return this.withModeManagement(() => {
      const waitForCallbackHandler = createWaitForCallbackHandler(
        this.executionContext,
        this.runInChildContext.bind(this),
      );
      const promise = waitForCallbackHandler(
        nameOrSubmitter!,
        submitterOrConfig,
        maybeConfig,
      );
      // Prevent unhandled promise rejections
      promise?.catch(() => {});
      return promise;
    });
  }

  waitForCondition<T>(
    nameOrCheckFunc: string | undefined | WaitForConditionCheckFunc<T>,
    checkFuncOrConfig?:
      | WaitForConditionCheckFunc<T>
      | WaitForConditionConfig<T>,
    maybeConfig?: WaitForConditionConfig<T>,
  ): Promise<T> {
    validateContextUsage(
      this._stepPrefix,
      "waitForCondition",
      this.executionContext.terminationManager,
    );
    return this.withModeManagement(() => {
      const waitForConditionHandler = createWaitForConditionHandler(
        this.executionContext,
        this.checkpoint,
        this.createStepId.bind(this),
        this.createContextLogger,
        this.addRunningOperation.bind(this),
        this.removeRunningOperation.bind(this),
        this.hasRunningOperations.bind(this),
        this.getOperationsEmitter.bind(this),
        this._parentId,
      );

      const promise =
        typeof nameOrCheckFunc === "string" || nameOrCheckFunc === undefined
          ? waitForConditionHandler(
              nameOrCheckFunc,
              checkFuncOrConfig as WaitForConditionCheckFunc<T>,
              maybeConfig!,
            )
          : waitForConditionHandler(
              nameOrCheckFunc,
              checkFuncOrConfig as WaitForConditionConfig<T>,
            );
      // Prevent unhandled promise rejections
      promise?.catch(() => {});
      return promise;
    });
  }

  map<TInput, TOutput>(
    nameOrItems: string | undefined | TInput[],
    itemsOrMapFunc: TInput[] | MapFunc<TInput, TOutput>,
    mapFuncOrConfig?: MapFunc<TInput, TOutput> | MapConfig<TInput, TOutput>,
    maybeConfig?: MapConfig<TInput, TOutput>,
  ): Promise<BatchResult<TOutput>> {
    validateContextUsage(
      this._stepPrefix,
      "map",
      this.executionContext.terminationManager,
    );
    return this.withModeManagement(() => {
      const mapHandler = createMapHandler(
        this.executionContext,
        this.executeConcurrently.bind(this),
      );
      return mapHandler(
        nameOrItems,
        itemsOrMapFunc,
        mapFuncOrConfig,
        maybeConfig,
      );
    });
  }

  parallel<T>(
    nameOrBranches:
      | string
      | undefined
      | (ParallelFunc<T> | NamedParallelBranch<T>)[],
    branchesOrConfig?:
      | (ParallelFunc<T> | NamedParallelBranch<T>)[]
      | ParallelConfig<T>,
    maybeConfig?: ParallelConfig<T>,
  ): Promise<BatchResult<T>> {
    validateContextUsage(
      this._stepPrefix,
      "parallel",
      this.executionContext.terminationManager,
    );
    return this.withModeManagement(() => {
      const parallelHandler = createParallelHandler(
        this.executionContext,
        this.executeConcurrently.bind(this),
      );
      return parallelHandler(nameOrBranches, branchesOrConfig, maybeConfig);
    });
  }

  executeConcurrently<TItem, TResult>(
    nameOrItems: string | undefined | ConcurrentExecutionItem<TItem>[],
    itemsOrExecutor?:
      | ConcurrentExecutionItem<TItem>[]
      | ConcurrentExecutor<TItem, TResult>,
    executorOrConfig?:
      | ConcurrentExecutor<TItem, TResult>
      | ConcurrencyConfig<TResult>,
    maybeConfig?: ConcurrencyConfig<TResult>,
  ): Promise<BatchResult<TResult>> {
    validateContextUsage(
      this._stepPrefix,
      "executeConcurrently",
      this.executionContext.terminationManager,
    );
    return this.withModeManagement(() => {
      const concurrentExecutionHandler = createConcurrentExecutionHandler(
        this.executionContext,
        this.runInChildContext.bind(this),
        this.skipNextOperation.bind(this),
      );
      const promise = concurrentExecutionHandler(
        nameOrItems,
        itemsOrExecutor,
        executorOrConfig,
        maybeConfig,
      );
      // Prevent unhandled promise rejections
      promise?.catch(() => {});
      return promise;
    });
  }

  get promise(): DurableContext["promise"] {
    return createPromiseHandler(this.step.bind(this));
  }
}

export const createDurableContext = (
  executionContext: ExecutionContext,
  parentContext: Context,
  durableExecutionMode: DurableExecutionMode,
  stepPrefix?: string,
  checkpointToken?: string,
  inheritedLogger?: Logger | null,
  parentId?: string,
): DurableContext => {
  return new DurableContextImpl(
    executionContext,
    parentContext,
    durableExecutionMode,
    stepPrefix,
    checkpointToken,
    inheritedLogger,
    parentId,
  );
};
