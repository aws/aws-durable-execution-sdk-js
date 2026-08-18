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
import { InternalDurableContext } from "../../types/internal-context";
import { Context } from "aws-lambda";
import { CheckpointManager } from "../../utils/checkpoint/checkpoint-manager";
import { EventEmitter } from "events";
import { createStepHandler } from "../../handlers/step-handler/step-handler";
import { createInvokeHandler } from "../../handlers/invoke-handler/invoke-handler";
import { createRunInChildContextHandler } from "../../handlers/run-in-child-context-handler/run-in-child-context-handler";
import { resolveChildArgs } from "../../handlers/run-in-child-context-handler/resolve-child-args";
import { createWaitHandler } from "../../handlers/wait-handler/wait-handler";
import { createWaitForConditionHandler } from "../../handlers/wait-for-condition-handler/wait-for-condition-handler";
import {
  createCallback as createCallbackFactory,
  createPassThroughSerdes,
} from "../../handlers/callback-handler/callback";
import { createWaitForCallbackHandler } from "../../handlers/wait-for-callback-handler/wait-for-callback-handler";
import { createMapHandler } from "../../handlers/map-handler/map-handler";
import { createParallelHandler } from "../../handlers/parallel-handler/parallel-handler";
import { createPromiseHandler } from "../../handlers/promise-handler/promise-handler";
import { createConcurrentExecutionHandler } from "../../handlers/concurrent-execution-handler/concurrent-execution-handler";
import { OperationStatus } from "../../types/wire";
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
import {
  SerdesConfig,
  defaultSerdes,
  AnySerdes,
  AnySerdesDeserializer,
} from "../../utils/serdes/serdes";
import { DurableInstrumentationPlugin } from "../../types/plugin";

export interface DurableExecution {
  checkpointManager: CheckpointManager;
  stepDataEmitter: EventEmitter;
  plugin: DurableInstrumentationPlugin;
  setTerminating(): void;
}

export const DURABLE_CONTEXT_BRAND = Symbol.for(
  "@aws/durable-execution-sdk-js/durable-context",
);

export class DurableContextImpl<Logger extends DurableLogger>
  implements DurableContext<Logger>, InternalDurableContext<Logger>
{
  readonly [DURABLE_CONTEXT_BRAND] = true;

  private _stepPrefix?: string;
  private _stepCounter: number = 0;
  private durableLogger: Logger;
  private modeAwareLoggingEnabled: boolean = true;
  private checkpoint: CheckpointManager;
  private durableExecutionMode: DurableExecutionMode;
  private _parentId?: string;
  private modeManagement: ModeManagement;
  private durableExecution: DurableExecution;

  /**
   * Remaining depth budget for preserving child-context operations across
   * suspend/resume. A context sets `ReplayChildren` on a child it runs when the
   * child's budget (this value minus 1) is >= 1. Decremented by one for each
   * nested context. `0` (default) disables preservation; `Infinity` preserves
   * the whole tree. Seeded at the root from
   * `DurableExecutionConfig.pluginsConfig.childOperationsDepth`.
   * @internal
   */
  private _preserveChildDepth: number = 0;

  private _defaultSerdes: AnySerdes = defaultSerdes;

  private _defaultCallbackDeserializer: AnySerdesDeserializer =
    createPassThroughSerdes();
  private _customCallbackDeserializerSet: boolean = false;

  public logger: DurableContextLogger<Logger>;
  public readonly executionContext: {
    readonly durableExecutionArn: string;
  };

  get [Symbol.toStringTag](): string {
    return "DurableContext";
  }

  constructor(
    private _executionContext: ExecutionContext,
    public lambdaContext: Context,
    durableExecutionMode: DurableExecutionMode,
    inheritedLogger: Logger,
    stepPrefix: string | undefined,
    durableExecution: DurableExecution,
    parentId?: string,
    preserveChildDepth: number = 0,
  ) {
    this._stepPrefix = stepPrefix;
    this._parentId = parentId;
    this._preserveChildDepth = preserveChildDepth;
    this.durableExecution = durableExecution;
    this.durableLogger = inheritedLogger;
    this.durableLogger.configureDurableLoggingContext?.(
      this.getDurableLoggingContext(),
    );
    this.logger = this.createModeAwareLogger(inheritedLogger);

    this.executionContext = {
      durableExecutionArn: _executionContext.durableExecutionArn,
    };

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
          executionArn: this._executionContext.durableExecutionArn,
          requestId: this._executionContext.requestId,
          tenantId: this._executionContext.tenantId,
          operationId:
            !activeContext || activeContext?.contextId === "root"
              ? undefined
              : hashId(activeContext.contextId),
        };

        if (
          activeContext &&
          activeContext.contextId !== "root" &&
          activeContext.operationName !== undefined
        ) {
          result.operationName = activeContext.operationName;
        }

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

  /**
   * Returns the step ID that the next {@link createStepId} call will mint,
   * WITHOUT advancing the counter. At operation boundaries (before the current
   * operation has claimed its ID) this is the ID of the current pending
   * operation — the one about to run.
   */
  private peekStepId(): string {
    const nextCounter = this._stepCounter + 1;
    return this._stepPrefix
      ? `${this._stepPrefix}-${nextCounter}`
      : `${nextCounter}`;
  }

  /**
   * Advances this context's step cursor by one without running an operation.
   *
   * Used by the concurrent-execution handler during summarized replay: when it
   * reconstructs a batch it reaches this method on the map/parallel child
   * context (via a narrow internal cast) to skip an item it does not
   * re-execute — one that was never started, or an in-flight item rebuilt as
   * STARTED. Advancing THIS context's cursor keeps the next terminal item's
   * runInChildContext aligned with its own step, so the non-resolving-promise
   * gate does not fire on the pending in-flight step (issue #751).
   * @internal
   */
  private skipNextOperation(): void {
    this._stepCounter++;
  }

  private checkAndUpdateReplayMode(): void {
    if (this.durableExecutionMode === DurableExecutionMode.ReplayMode) {
      const pendingStepId = this.peekStepId();
      const pendingStepData = this._executionContext.getStepData(pendingStepId);
      // A virtual context (runInChildContext with virtualContext: true) is not
      // checkpointed itself, so getStepData(pendingStepId) returns undefined
      // even though replay should continue. Its first child operation IS
      // checkpointed under `${pendingStepId}-1`, so probe that before
      // concluding replay has finished. Without this check, replay mode is
      // prematurely switched to execution mode after a virtual context (issue
      // #578).
      const hasCheckpointedChild =
        !pendingStepData &&
        this._executionContext.getStepData(`${pendingStepId}-1`) !== undefined;
      if (!pendingStepData && !hasCheckpointedChild) {
        this.durableExecutionMode = DurableExecutionMode.ExecutionMode;
      }
    }
  }

  private captureExecutionState(): boolean {
    const wasInReplayMode =
      this.durableExecutionMode === DurableExecutionMode.ReplayMode;
    const pendingStepId = this.peekStepId();
    const stepData = this._executionContext.getStepData(pendingStepId);
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
      const pendingStepId = this.peekStepId();
      const pendingStepData = this._executionContext.getStepData(pendingStepId);
      if (
        pendingStepData &&
        pendingStepData.Status !== OperationStatus.SUCCEEDED &&
        pendingStepData.Status !== OperationStatus.FAILED
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
    return this.stepInternal(undefined, nameOrFn, fnOrOptions, maybeOptions);
  }

  /**
   * {@link step} variant that also labels the span with a plugin-only name.
   * Never checkpointed. See {@link InternalDurableContext}.
   * @internal
   */
  _stepWithPluginOperationName<T>(
    pluginOperationName: string | undefined,
    nameOrFn: string | undefined | StepFunc<T, Logger>,
    fnOrOptions?: StepFunc<T, Logger> | StepConfig<T>,
    maybeOptions?: StepConfig<T>,
  ): DurablePromise<T> {
    return this.stepInternal(
      pluginOperationName,
      nameOrFn,
      fnOrOptions,
      maybeOptions,
    );
  }

  private stepInternal<T>(
    pluginOperationName: string | undefined,
    nameOrFn: string | undefined | StepFunc<T, Logger>,
    fnOrOptions?: StepFunc<T, Logger> | StepConfig<T>,
    maybeOptions?: StepConfig<T>,
  ): DurablePromise<T> {
    validateContextUsage(
      this._stepPrefix,
      "step",
      this._executionContext.terminationManager,
    );

    return this.withDurableModeManagement(() => {
      const stepHandler = createStepHandler(
        this._executionContext,
        this.checkpoint,
        this.lambdaContext,
        this.createStepId.bind(this),
        this.durableLogger,
        this._parentId,
        () => this._defaultSerdes,
        this.durableExecution.plugin,
        pluginOperationName,
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
      this._executionContext.terminationManager,
    );
    return this.withDurableModeManagement(() => {
      const invokeHandler = createInvokeHandler(
        this._executionContext,
        this.checkpoint,
        this.createStepId.bind(this),
        this._parentId,
        this.checkAndUpdateReplayMode.bind(this),
        () => this._defaultSerdes,
        this.durableExecution.plugin,
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
      this._executionContext.terminationManager,
    );
    return this.withDurableModeManagement(() => {
      // Budget handed to the child context we're about to run: one level less
      // than ours (Infinity stays Infinity, and it never goes below 0). This
      // both (a) decides whether the child's own children are preserved
      // (ReplayChildren, in executeChildContext) and (b) seeds the child
      // context so its grandchildren decrement further.
      //
      // Virtual contexts (map/parallel FLAT nesting) are the exception: they
      // don't checkpoint and their children re-parent onto this context's
      // ancestor, so they add no node to the operation tree. Decrementing for
      // them would make `childOperationsDepth` count invisible layers and come
      // up short (off-by-one) for contexts nested inside a FLAT item. So pass
      // the budget through unchanged for a virtual child, keeping the depth
      // aligned with the visible operation tree.
      const { options: childOptions } = resolveChildArgs<T, Logger>(
        nameOrFn,
        fnOrOptions,
        maybeOptions,
      );
      const isVirtualChild = childOptions?.virtualContext === true;
      const childPreserveDepth = isVirtualChild
        ? this._preserveChildDepth
        : this._preserveChildDepth === Infinity
          ? Infinity
          : Math.max(0, this._preserveChildDepth - 1);
      const blockHandler = createRunInChildContextHandler(
        this._executionContext,
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
        ) => {
          const childCtx = createDurableContext(
            executionContext,
            parentContext,
            durableExecutionMode,
            inheritedLogger,
            stepPrefix,
            this.durableExecution,
            parentId,
            childPreserveDepth,
          );
          // Propagate serdes config to child context
          childCtx.configureSerdes({
            defaultSerdes: this._defaultSerdes,
            ...(this._customCallbackDeserializerSet && {
              defaultCallbackDeserializer: this._defaultCallbackDeserializer,
            }),
          });
          return childCtx;
        },
        this._parentId,
        () => this._defaultSerdes,
        this.durableExecution.plugin,
        childPreserveDepth,
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
      this._executionContext.terminationManager,
    );
    return this.withDurableModeManagement(() => {
      const waitHandler = createWaitHandler(
        this._executionContext,
        this.checkpoint,
        this.createStepId.bind(this),
        this._parentId,
        this.checkAndUpdateReplayMode.bind(this),
        this.durableExecution.plugin,
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

  configureSerdes(config: SerdesConfig): void {
    if (config.defaultSerdes !== undefined) {
      this._defaultSerdes = config.defaultSerdes;
    }
    if (config.defaultCallbackDeserializer !== undefined) {
      this._defaultCallbackDeserializer = config.defaultCallbackDeserializer;
      this._customCallbackDeserializerSet = true;
    }
  }

  createCallback<T>(
    nameOrConfig?: string | CreateCallbackConfig<T>,
    maybeConfig?: CreateCallbackConfig<T>,
  ): DurablePromise<CreateCallbackResult<T>> {
    return this.createCallbackInternal(undefined, nameOrConfig, maybeConfig);
  }

  /**
   * {@link createCallback} variant that also labels the span with a
   * plugin-only name. Never checkpointed. See {@link InternalDurableContext}.
   * @internal
   */
  _createCallbackWithPluginOperationName<T>(
    pluginOperationName: string | undefined,
    nameOrConfig?: string | CreateCallbackConfig<T>,
    maybeConfig?: CreateCallbackConfig<T>,
  ): DurablePromise<CreateCallbackResult<T>> {
    return this.createCallbackInternal(
      pluginOperationName,
      nameOrConfig,
      maybeConfig,
    );
  }

  private createCallbackInternal<T>(
    pluginOperationName: string | undefined,
    nameOrConfig?: string | CreateCallbackConfig<T>,
    maybeConfig?: CreateCallbackConfig<T>,
  ): DurablePromise<CreateCallbackResult<T>> {
    validateContextUsage(
      this._stepPrefix,
      "createCallback",
      this._executionContext.terminationManager,
    );
    return this.withDurableModeManagement(() => {
      const callbackFactory = createCallbackFactory(
        this._executionContext,
        this.checkpoint,
        this.createStepId.bind(this),
        this.checkAndUpdateReplayMode.bind(this),
        this._parentId,
        () => this._defaultCallbackDeserializer,
        this.durableExecution.plugin,
        pluginOperationName,
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
      this._executionContext.terminationManager,
    );
    return this.withDurableModeManagement(() => {
      const waitForCallbackHandler = createWaitForCallbackHandler(
        this._executionContext,
        this.peekStepId.bind(this),
        this.runInChildContext.bind(this),
        // Only pass the getter when the user has explicitly configured a custom
        // deserializer. The default is createPassThroughSerdes() which matches
        // the original behavior, so no injection is needed in that case.
        this._customCallbackDeserializerSet
          ? (): AnySerdesDeserializer => this._defaultCallbackDeserializer
          : undefined,
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
      this._executionContext.terminationManager,
    );
    return this.withDurableModeManagement(() => {
      const waitForConditionHandler = createWaitForConditionHandler(
        this._executionContext,
        this.checkpoint,
        this.createStepId.bind(this),
        this.durableLogger,
        this._parentId,
        () => this._defaultSerdes,
        this.durableExecution.plugin,
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
      this._executionContext.terminationManager,
    );
    return this.withDurableModeManagement(() => {
      const mapHandler = createMapHandler(
        this._executionContext,
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
      this._executionContext.terminationManager,
    );
    return this.withDurableModeManagement(() => {
      const parallelHandler = createParallelHandler(
        this._executionContext,
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
      this._executionContext.terminationManager,
    );
    return this.withDurableModeManagement(() => {
      const concurrentExecutionHandler = createConcurrentExecutionHandler(
        this._executionContext,
        this.runInChildContext.bind(this),
        () => this._defaultSerdes,
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
    return createPromiseHandler(this.runInChildContext.bind(this));
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
  preserveChildDepth: number = 0,
): DurableContextImpl<Logger> => {
  return new DurableContextImpl<Logger>(
    executionContext,
    parentContext,
    durableExecutionMode,
    inheritedLogger,
    stepPrefix,
    durableExecution,
    parentId,
    preserveChildDepth,
  );
};
