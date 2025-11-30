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
  LoggerConfig,
  InvokeConfig,
  DurableExecutionMode,
  BatchResult,
  DurablePromise,
  DurableLogData,
} from "../../types";
import { Context } from "aws-lambda";
import { CheckpointManager } from "../../utils/checkpoint/checkpoint-manager";
import { EventEmitter } from "events";
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
import { ModeManagement } from "./mode-management/mode-management";
import {
  getActiveContext,
  validateContextUsage,
} from "../../utils/context-tracker/context-tracker";
import {
  DurableContextLogger,
  DurableLogger,
  DurableLoggingContext,
} from "../../types/durable-logger";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

export interface DurableExecution {
  checkpointManager: CheckpointManager;
  stepDataEmitter: EventEmitter;
  setTerminating(): void;
}

export class DurableContextImpl<Logger extends DurableLogger>
  implements DurableContext<Logger>
{
  private _stepPrefix?: string;
  private _stepCounter: number = 0;
  private durableLogger: Logger;
  private modeAwareLoggingEnabled: boolean = true;
  private checkpoint: CheckpointManager;
  private durableExecutionMode: DurableExecutionMode;
  private _parentId?: string;
  private modeManagement: ModeManagement;
  private durableExecution: DurableExecution;

  public logger: DurableContextLogger<Logger>;

  constructor(
    private executionContext: ExecutionContext,
    public lambdaContext: Context,
    durableExecutionMode: DurableExecutionMode,
    inheritedLogger: Logger,
    stepPrefix: string | undefined,
    durableExecution: DurableExecution,
    parentId?: string,
  ) {
    this._stepPrefix = stepPrefix;
    this._parentId = parentId;
    this.durableExecution = durableExecution;
    this.durableLogger = inheritedLogger;
    this.durableLogger.configureDurableLoggingContext?.(
      this.getDurableLoggingContext(),
    );
    this.logger = this.createModeAwareLogger(inheritedLogger);

    this.durableExecutionMode = durableExecutionMode;

    this.checkpoint = durableExecution.checkpointManager;

    this.modeManagement = new ModeManagement(
      this.captureExecutionState.bind(this),
      this.checkAndUpdateReplayMode.bind(this),
      this.checkForNonResolvingPromise.bind(this),
      () => this.durableExecutionMode,
      (mode) => {
        this.durableExecutionMode = mode;
      },
    );
  }

  getDurableLoggingContext(): DurableLoggingContext {
    return {
      getDurableLogData: (): DurableLogData => {
        const activeContext = getActiveContext();

        const result: DurableLogData = {
          executionArn: this.executionContext.durableExecutionArn,
          requestId: this.executionContext.requestId,
          tenantId: this.executionContext.tenantId,
          operationId:
            !activeContext || activeContext?.contextId === "root"
              ? undefined
              : hashId(activeContext.contextId),
        };

        if (activeContext?.attempt !== undefined) {
          result.attempt = activeContext.attempt;
        }

        return result;
      },
    };
  }

  private shouldLog(): boolean {
    const activeContext = getActiveContext();

    if (!this.modeAwareLoggingEnabled || !activeContext) {
      return true;
    }

    if (activeContext.contextId === "root") {
      return this.durableExecutionMode === DurableExecutionMode.ExecutionMode;
    }

    return (
      activeContext.durableExecutionMode === DurableExecutionMode.ExecutionMode
    );
  }

  private createModeAwareLogger(logger: Logger): DurableContextLogger<Logger> {
    const durableContextLogger: DurableContextLogger<Logger> = {
      warn: (...args) => {
        if (this.shouldLog()) {
          return logger.warn(...args);
        }
      },
      debug: (...args) => {
        if (this.shouldLog()) {
          return logger.debug(...args);
        }
      },
      info: (...args) => {
        if (this.shouldLog()) {
          return logger.info(...args);
        }
      },
      error: (...args) => {
        if (this.shouldLog()) {
          return logger.error(...args);
        }
      },
    };

    if ("log" in logger) {
      durableContextLogger.log = (level, ...args): void => {
        if (this.shouldLog()) {
          return logger.log?.(level, ...args);
        }
      };
    }

    return durableContextLogger;
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

  private withModeManagement<T>(operation: () => Promise<T>): Promise<T> {
    return this.modeManagement.withModeManagement(operation);
  }

  private withDurableModeManagement<T>(
    operation: () => DurablePromise<T>,
  ): DurablePromise<T> {
    return this.modeManagement.withDurableModeManagement(operation);
  }

  step<T>(
    nameOrFn: string | undefined | StepFunc<T, Logger>,
    fnOrOptions?: StepFunc<T, Logger> | StepConfig<T>,
    maybeOptions?: StepConfig<T>,
  ): DurablePromise<T> {
    validateContextUsage(
      this._stepPrefix,
      "step",
      this.executionContext.terminationManager,
    );

    return this.withDurableModeManagement(() => {
      const stepHandler = createStepHandler(
        this.executionContext,
        this.checkpoint,
        this.lambdaContext,
        this.createStepId.bind(this),
        this.durableLogger,
        this._parentId,
      );

      return stepHandler(nameOrFn, fnOrOptions, maybeOptions);
    });
  }

  invoke<I, O>(
    nameOrFuncId: string,
    funcIdOrInput?: string | I,
    inputOrConfig?: I | InvokeConfig<I, O>,
    maybeConfig?: InvokeConfig<I, O>,
  ): DurablePromise<O> {
    validateContextUsage(
      this._stepPrefix,
      "invoke",
      this.executionContext.terminationManager,
    );
    return this.withDurableModeManagement(() => {
      const invokeHandler = createInvokeHandler(
        this.executionContext,
        this.checkpoint,
        this.createStepId.bind(this),
        this._parentId,
        this.checkAndUpdateReplayMode.bind(this),
      );
      return invokeHandler<I, O>(
        ...([
          nameOrFuncId,
          funcIdOrInput,
          inputOrConfig,
          maybeConfig,
        ] as Parameters<typeof invokeHandler<I, O>>),
      );
    });
  }

  runInChildContext<T>(
    nameOrFn: string | undefined | ChildFunc<T, Logger>,
    fnOrOptions?: ChildFunc<T, Logger> | ChildConfig<T>,
    maybeOptions?: ChildConfig<T>,
  ): DurablePromise<T> {
    validateContextUsage(
      this._stepPrefix,
      "runInChildContext",
      this.executionContext.terminationManager,
    );
    return this.withDurableModeManagement(() => {
      const blockHandler = createRunInChildContextHandler(
        this.executionContext,
        this.checkpoint,
        this.lambdaContext,
        this.createStepId.bind(this),
        () => this.durableLogger,
        // Adapter function to maintain compatibility
        (
          executionContext,
          parentContext,
          durableExecutionMode,
          inheritedLogger,
          stepPrefix,
          _checkpointToken,
          parentId,
        ) =>
          createDurableContext(
            executionContext,
            parentContext,
            durableExecutionMode,
            inheritedLogger,
            stepPrefix,
            this.durableExecution,
            parentId,
          ),
        this._parentId,
      );
      return blockHandler(nameOrFn, fnOrOptions, maybeOptions);
    });
  }

  wait(
    nameOrDuration: string | Duration,
    maybeDuration?: Duration,
  ): DurablePromise<void> {
    validateContextUsage(
      this._stepPrefix,
      "wait",
      this.executionContext.terminationManager,
    );
    return this.withDurableModeManagement(() => {
      const waitHandler = createWaitHandler(
        this.executionContext,
        this.checkpoint,
        this.createStepId.bind(this),
        this._parentId,
        this.checkAndUpdateReplayMode.bind(this),
      );
      return typeof nameOrDuration === "string"
        ? waitHandler(nameOrDuration, maybeDuration!)
        : waitHandler(nameOrDuration);
    });
  }

  /**
   * Configure logger behavior for this context
   *
   * This method allows partial configuration - only the properties provided will be updated.
   * For example, calling configureLogger(\{ modeAware: false \}) will only change the modeAware
   * setting without affecting any previously configured custom logger.
   *
   * @param config - Logger configuration options including customLogger and modeAware settings (default: modeAware=true)
   * @example
   * // Set custom logger and enable mode-aware logging
   * context.configureLogger(\{ customLogger: myLogger, modeAware: true \});
   *
   * // Later, disable mode-aware logging without changing the custom logger
   * context.configureLogger(\{ modeAware: false \});
   */
  configureLogger(config: LoggerConfig<Logger>): void {
    if (config.customLogger !== undefined) {
      this.durableLogger = config.customLogger;
      this.durableLogger.configureDurableLoggingContext?.(
        this.getDurableLoggingContext(),
      );
      this.logger = this.createModeAwareLogger(this.durableLogger);
    }
    if (config.modeAware !== undefined) {
      this.modeAwareLoggingEnabled = config.modeAware;
    }
  }

  createCallback<T>(
    nameOrConfig?: string | CreateCallbackConfig<T>,
    maybeConfig?: CreateCallbackConfig<T>,
  ): DurablePromise<CreateCallbackResult<T>> {
    validateContextUsage(
      this._stepPrefix,
      "createCallback",
      this.executionContext.terminationManager,
    );
    return this.withDurableModeManagement(() => {
      const callbackFactory = createCallbackFactory(
        this.executionContext,
        this.checkpoint,
        this.createStepId.bind(this),
        this.checkAndUpdateReplayMode.bind(this),
        this._parentId,
      );
      return callbackFactory(nameOrConfig, maybeConfig);
    });
  }

  waitForCallback<T>(
    nameOrSubmitter?: string | undefined | WaitForCallbackSubmitterFunc<Logger>,
    submitterOrConfig?:
      | WaitForCallbackSubmitterFunc<Logger>
      | WaitForCallbackConfig<T>,
    maybeConfig?: WaitForCallbackConfig<T>,
  ): DurablePromise<T> {
    validateContextUsage(
      this._stepPrefix,
      "waitForCallback",
      this.executionContext.terminationManager,
    );
    return this.withDurableModeManagement(() => {
      const waitForCallbackHandler = createWaitForCallbackHandler(
        this.executionContext,
        this.getNextStepId.bind(this),
        this.runInChildContext.bind(this),
      );
      return waitForCallbackHandler(
        nameOrSubmitter!,
        submitterOrConfig,
        maybeConfig,
      );
    });
  }

  waitForCondition<T>(
    nameOrCheckFunc: string | undefined | WaitForConditionCheckFunc<T, Logger>,
    checkFuncOrConfig?:
      | WaitForConditionCheckFunc<T, Logger>
      | WaitForConditionConfig<T>,
    maybeConfig?: WaitForConditionConfig<T>,
  ): DurablePromise<T> {
    validateContextUsage(
      this._stepPrefix,
      "waitForCondition",
      this.executionContext.terminationManager,
    );
    return this.withDurableModeManagement(() => {
      const waitForConditionHandler = createWaitForConditionHandler(
        this.executionContext,
        this.checkpoint,
        this.createStepId.bind(this),
        this.durableLogger,
        this._parentId,
      );

      return typeof nameOrCheckFunc === "string" ||
        nameOrCheckFunc === undefined
        ? waitForConditionHandler(
            nameOrCheckFunc,
            checkFuncOrConfig as WaitForConditionCheckFunc<T, Logger>,
            maybeConfig!,
          )
        : waitForConditionHandler(
            nameOrCheckFunc,
            checkFuncOrConfig as WaitForConditionConfig<T>,
          );
    });
  }

  map<TInput, TOutput>(
    nameOrItems: string | undefined | TInput[],
    itemsOrMapFunc: TInput[] | MapFunc<TInput, TOutput, Logger>,
    mapFuncOrConfig?:
      | MapFunc<TInput, TOutput, Logger>
      | MapConfig<TInput, TOutput>,
    maybeConfig?: MapConfig<TInput, TOutput>,
  ): DurablePromise<BatchResult<TOutput>> {
    validateContextUsage(
      this._stepPrefix,
      "map",
      this.executionContext.terminationManager,
    );
    return this.withDurableModeManagement(() => {
      const mapHandler = createMapHandler(
        this.executionContext,
        this._executeConcurrently.bind(this),
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
      | (ParallelFunc<T, Logger> | NamedParallelBranch<T, Logger>)[],
    branchesOrConfig?:
      | (ParallelFunc<T, Logger> | NamedParallelBranch<T, Logger>)[]
      | ParallelConfig<T>,
    maybeConfig?: ParallelConfig<T>,
  ): DurablePromise<BatchResult<T>> {
    validateContextUsage(
      this._stepPrefix,
      "parallel",
      this.executionContext.terminationManager,
    );
    return this.withDurableModeManagement(() => {
      const parallelHandler = createParallelHandler(
        this.executionContext,
        this._executeConcurrently.bind(this),
      );
      return parallelHandler(nameOrBranches, branchesOrConfig, maybeConfig);
    });
  }

  _executeConcurrently<TItem, TResult>(
    nameOrItems: string | undefined | ConcurrentExecutionItem<TItem>[],
    itemsOrExecutor?:
      | ConcurrentExecutionItem<TItem>[]
      | ConcurrentExecutor<TItem, TResult, Logger>,
    executorOrConfig?:
      | ConcurrentExecutor<TItem, TResult, Logger>
      | ConcurrencyConfig<TResult>,
    maybeConfig?: ConcurrencyConfig<TResult>,
  ): DurablePromise<BatchResult<TResult>> {
    validateContextUsage(
      this._stepPrefix,
      "_executeConcurrently",
      this.executionContext.terminationManager,
    );
    return this.withDurableModeManagement(() => {
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

  get promise(): DurableContext<Logger>["promise"] {
    return createPromiseHandler(this.step.bind(this));
  }
}

export const createDurableContext = <Logger extends DurableLogger>(
  executionContext: ExecutionContext,
  parentContext: Context,
  durableExecutionMode: DurableExecutionMode,
  inheritedLogger: Logger,
  stepPrefix: string | undefined,
  durableExecution: DurableExecution,
  parentId?: string,
): DurableContextImpl<Logger> => {
  return new DurableContextImpl<Logger>(
    executionContext,
    parentContext,
    durableExecutionMode,
    inheritedLogger,
    stepPrefix,
    durableExecution,
    parentId,
  );
};
