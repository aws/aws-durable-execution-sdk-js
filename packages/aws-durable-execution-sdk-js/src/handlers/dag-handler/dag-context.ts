import type { DurableContextImpl } from "../../context/durable-context/durable-context";
import { DurableLogger } from "../../types/durable-logger";
import { Duration } from "../../types/core";
import {
  BatchResult,
  MapConfig,
  MapFunc,
  NamedParallelBranch,
  ParallelConfig,
  ParallelFunc,
} from "../../types/batch";
import { StepConfig, StepFunc } from "../../types/step";
import { InvokeConfig } from "../../types/invoke";
import { ChildConfig, ChildFunc } from "../../types/child-context";
import {
  WaitForCallbackConfig,
  WaitForCallbackSubmitterFunc,
} from "../../types/callback";
import {
  WaitForConditionCheckFunc,
  WaitForConditionConfig,
} from "../../types/wait-condition";
import {
  StepContext,
  WaitForCallbackContext,
  WaitForConditionContext,
} from "../../types/logger";
import { DurableContext } from "../../types/durable-context";
import {
  AnyTaskHandle,
  CheckTaskFn,
  ChildTaskFn,
  ConditionalConfig,
  DagConfig,
  DagContext,
  DagResult,
  DepsMap,
  NestedDagConfig,
  PayloadTaskFn,
  StepTaskFn,
  SubmitterTaskFn,
  TaskHandle,
} from "../../types/dag";
import { TaskDef, TaskHandleImpl, TaskKind } from "./task-handle";
import { validateTaskName } from "./dag-validator";
import { DagDuplicateTaskError } from "../../errors/dag-errors/dag-errors";

type AnyConditional = ConditionalConfig<readonly AnyTaskHandle[]>;

const extractConditional = <O>(
  options: (O & AnyConditional) | undefined,
): {
  runIf?: (deps: Record<string, unknown>) => boolean;
  rest: O | undefined;
} => {
  if (options === undefined || options === null) {
    return { rest: undefined };
  }
  const { runIf, ...rest } = options as O & {
    runIf?: (deps: Record<string, unknown>) => boolean;
  };
  return { runIf, rest: rest as O };
};

/**
 * Declarative registration context passed to `context.dag(...)`'s `register`
 * callback. Each method validates the task name, rejects duplicates, builds a
 * {@link TaskDef} (whose executor delegates to a name-based explicit-ID
 * variant), stores it, and returns a {@link TaskHandleImpl}. Executors are NOT
 * invoked during registration.
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class DagContextImpl<
  TLogger extends DurableLogger = DurableLogger,
> implements DagContext<TLogger> {
  private readonly tasks = new Map<string, TaskDef>();

  constructor(private readonly config?: DagConfig) {}

  /** @internal Returns the registered tasks in registration order. */
  getTasks(): TaskDef[] {
    return [...this.tasks.values()];
  }

  /**
   * Applies the DAG-level {@link DagConfig.nesting} default to a task config
   * that does not declare its own `nesting`. Only meaningful for task kinds
   * whose config carries a `nesting` (map, parallel).
   */
  private applyNestingDefault<O>(rest: O | undefined): O | undefined {
    const nesting = this.config?.nesting;
    if (nesting === undefined) {
      return rest;
    }
    if (rest && (rest as { nesting?: unknown }).nesting !== undefined) {
      return rest;
    }
    return { ...(rest as object), nesting } as O;
  }

  private register(name: string, def: TaskDef): void {
    validateTaskName(name);
    if (this.tasks.has(name)) {
      throw new DagDuplicateTaskError(name);
    }
    if (this.config?.defaultTriggerRule && def.triggerRule === undefined) {
      def.triggerRule = this.config.defaultTriggerRule;
    }
    this.tasks.set(name, def);
  }

  private makeDef(
    name: string,
    kind: TaskKind,
    inlineDeps: readonly AnyTaskHandle[],
    runIf: ((deps: Record<string, unknown>) => boolean) | undefined,
    options: unknown,
    executor: TaskDef["executor"],
  ): TaskDef {
    return {
      name,
      id: Symbol(name),
      kind,
      inlineDeps,
      allDeps: [...inlineDeps],
      runIf,
      options,
      executor,
    };
  }

  step<TName extends string, TDeps extends readonly AnyTaskHandle[], TResult>(
    name: TName,
    deps: TDeps,
    fn: StepTaskFn<TDeps, TResult, TLogger>,
    config?: StepConfig<TResult> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TResult>;

  step<TName extends string, TResult>(
    name: TName,
    deps: readonly [],
    fn: (ctx: StepContext<TLogger>) => Promise<TResult>,
    config?: StepConfig<TResult> & ConditionalConfig<readonly []>,
  ): TaskHandle<TName, TResult>;

  step<TName extends string, TDeps extends readonly AnyTaskHandle[], TResult>(
    name: TName,
    deps: TDeps,
    fn: StepTaskFn<TDeps, TResult, TLogger>,
    config?: StepConfig<TResult> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TResult> {
    const { runIf, rest } = extractConditional(config);
    const def = this.makeDef(name, "step", deps, runIf, rest, (ctx, depsMap) =>
      ctx.runStepWithExplicitId(
        name,
        (deps.length === 0
          ? (stepCtx: unknown) =>
              (fn as (c: unknown) => Promise<TResult>)(stepCtx)
          : (stepCtx: unknown) =>
              (fn as (d: unknown, c: unknown) => Promise<TResult>)(
                depsMap,
                stepCtx,
              )) as StepFunc<TResult, DurableLogger>,
        rest as StepConfig<TResult> | undefined,
      ),
    );
    this.register(name, def);
    return new TaskHandleImpl<TName, TResult>(name, def.id, def);
  }

  invoke<
    TName extends string,
    TDeps extends readonly AnyTaskHandle[],
    TIn,
    TOut,
  >(
    name: TName,
    funcId: string,
    deps: TDeps,
    payloadFn: PayloadTaskFn<TDeps, TIn>,
    config?: InvokeConfig<TIn, TOut> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TOut>;

  invoke<TName extends string, TIn, TOut>(
    name: TName,
    funcId: string,
    deps: readonly [],
    payloadFn: () => TIn | Promise<TIn>,
    config?: InvokeConfig<TIn, TOut> & ConditionalConfig<readonly []>,
  ): TaskHandle<TName, TOut>;

  invoke<
    TName extends string,
    TDeps extends readonly AnyTaskHandle[],
    TIn,
    TOut,
  >(
    name: TName,
    funcId: string,
    deps: TDeps,
    payloadFn: PayloadTaskFn<TDeps, TIn>,
    config?: InvokeConfig<TIn, TOut> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TOut> {
    const { runIf, rest } = extractConditional(config);
    const def = this.makeDef(
      name,
      "invoke",
      deps,
      runIf,
      rest,
      async (ctx, depsMap) => {
        const payload = (await (deps.length === 0
          ? (payloadFn as () => TIn | Promise<TIn>)()
          : (payloadFn as (d: unknown) => TIn | Promise<TIn>)(depsMap))) as TIn;
        return ctx.runInvokeWithExplicitId<TIn, TOut>(
          name,
          funcId,
          payload,
          rest as InvokeConfig<TIn, TOut> | undefined,
        );
      },
    );
    this.register(name, def);
    return new TaskHandleImpl<TName, TOut>(name, def.id, def);
  }

  callback<
    TName extends string,
    TDeps extends readonly AnyTaskHandle[],
    TResult = string,
  >(
    name: TName,
    deps: TDeps,
    submitter: SubmitterTaskFn<TDeps, TLogger>,
    config?: WaitForCallbackConfig<TResult> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TResult>;

  callback<TName extends string, TResult = string>(
    name: TName,
    deps: readonly [],
    submitter: (
      callbackId: string,
      ctx: WaitForCallbackContext<TLogger>,
    ) => Promise<void>,
    config?: WaitForCallbackConfig<TResult> & ConditionalConfig<readonly []>,
  ): TaskHandle<TName, TResult>;

  callback<
    TName extends string,
    TDeps extends readonly AnyTaskHandle[],
    TResult = string,
  >(
    name: TName,
    deps: TDeps,
    submitter: SubmitterTaskFn<TDeps, TLogger>,
    config?: WaitForCallbackConfig<TResult> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TResult> {
    const { runIf, rest } = extractConditional(config);
    const def = this.makeDef(
      name,
      "callback",
      deps,
      runIf,
      rest,
      (ctx, depsMap) =>
        ctx.runCallbackTaskWithExplicitId<TResult>(
          name,
          (deps.length === 0
            ? (cbId: string, cbCtx: unknown) =>
                (submitter as (id: string, c: unknown) => Promise<void>)(
                  cbId,
                  cbCtx,
                )
            : (cbId: string, cbCtx: unknown) =>
                (
                  submitter as (
                    d: unknown,
                    id: string,
                    c: unknown,
                  ) => Promise<void>
                )(
                  depsMap,
                  cbId,
                  cbCtx,
                )) as WaitForCallbackSubmitterFunc<DurableLogger>,
          rest as WaitForCallbackConfig<TResult> | undefined,
        ),
    );
    this.register(name, def);
    return new TaskHandleImpl<TName, TResult>(name, def.id, def);
  }

  wait<TName extends string, TDeps extends readonly AnyTaskHandle[]>(
    name: TName,
    deps: TDeps,
    duration: Duration,
    config?: ConditionalConfig<TDeps>,
  ): TaskHandle<TName, void> {
    const { runIf } = extractConditional(config);
    const def = this.makeDef(name, "wait", deps, runIf, undefined, (ctx) =>
      ctx.runWaitWithExplicitId(name, duration),
    );
    this.register(name, def);
    return new TaskHandleImpl<TName, void>(name, def.id, def);
  }

  waitForCondition<
    TName extends string,
    TDeps extends readonly AnyTaskHandle[],
    TState,
  >(
    name: TName,
    deps: TDeps,
    check: CheckTaskFn<TDeps, TState, TLogger>,
    config: WaitForConditionConfig<TState> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TState>;

  waitForCondition<TName extends string, TState>(
    name: TName,
    deps: readonly [],
    check: (
      state: TState,
      ctx: WaitForConditionContext<TLogger>,
    ) => Promise<TState>,
    config: WaitForConditionConfig<TState> & ConditionalConfig<readonly []>,
  ): TaskHandle<TName, TState>;

  waitForCondition<
    TName extends string,
    TDeps extends readonly AnyTaskHandle[],
    TState,
  >(
    name: TName,
    deps: TDeps,
    check: CheckTaskFn<TDeps, TState, TLogger>,
    config: WaitForConditionConfig<TState> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TState> {
    const { runIf, rest } = extractConditional(config);
    const def = this.makeDef(
      name,
      "waitForCondition",
      deps,
      runIf,
      rest,
      (ctx, depsMap) =>
        ctx.runWaitForConditionWithExplicitId<TState>(
          name,
          (deps.length === 0
            ? (state: TState, wcCtx: unknown) =>
                (check as (s: TState, c: unknown) => Promise<TState>)(
                  state,
                  wcCtx,
                )
            : (state: TState, wcCtx: unknown) =>
                (
                  check as (
                    d: unknown,
                    s: TState,
                    c: unknown,
                  ) => Promise<TState>
                )(depsMap, state, wcCtx)) as WaitForConditionCheckFunc<
            TState,
            DurableLogger
          >,
          rest as WaitForConditionConfig<TState>,
        ),
    );
    this.register(name, def);
    return new TaskHandleImpl<TName, TState>(name, def.id, def);
  }

  runInChildContext<
    TName extends string,
    TDeps extends readonly AnyTaskHandle[],
    TResult,
  >(
    name: TName,
    deps: TDeps,
    fn: ChildTaskFn<TDeps, TResult, TLogger>,
    config?: ChildConfig<TResult> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TResult>;

  runInChildContext<TName extends string, TResult>(
    name: TName,
    deps: readonly [],
    fn: (ctx: DurableContext<TLogger>) => Promise<TResult>,
    config?: ChildConfig<TResult> & ConditionalConfig<readonly []>,
  ): TaskHandle<TName, TResult>;

  runInChildContext<
    TName extends string,
    TDeps extends readonly AnyTaskHandle[],
    TResult,
  >(
    name: TName,
    deps: TDeps,
    fn: ChildTaskFn<TDeps, TResult, TLogger>,
    config?: ChildConfig<TResult> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TResult> {
    const { runIf, rest } = extractConditional(config);
    const def = this.makeDef(
      name,
      "runInChildContext",
      deps,
      runIf,
      rest,
      (ctx, depsMap) =>
        ctx.runInChildContextWithExplicitId<TResult>(
          name,
          (deps.length === 0
            ? (childCtx: unknown) =>
                (fn as (c: unknown) => Promise<TResult>)(childCtx)
            : (childCtx: unknown) =>
                (fn as (d: unknown, c: unknown) => Promise<TResult>)(
                  depsMap,
                  childCtx,
                )) as ChildFunc<TResult, DurableLogger>,
          rest as ChildConfig<TResult> | undefined,
        ),
    );
    this.register(name, def);
    return new TaskHandleImpl<TName, TResult>(name, def.id, def);
  }

  map<TName extends string, TDeps extends readonly AnyTaskHandle[], TIn, TOut>(
    name: TName,
    deps: TDeps,
    items: TIn[] | ((deps: DepsMap<TDeps>) => TIn[]),
    mapFunc: MapFunc<TIn, TOut, TLogger>,
    config?: MapConfig<TIn, TOut> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, BatchResult<TOut>>;

  map<TName extends string, TIn, TOut>(
    name: TName,
    deps: readonly [],
    items: TIn[] | (() => TIn[]),
    mapFunc: MapFunc<TIn, TOut, TLogger>,
    config?: MapConfig<TIn, TOut> & ConditionalConfig<readonly []>,
  ): TaskHandle<TName, BatchResult<TOut>>;

  map<TName extends string, TDeps extends readonly AnyTaskHandle[], TIn, TOut>(
    name: TName,
    deps: TDeps,
    items: TIn[] | ((deps: DepsMap<TDeps>) => TIn[]),
    mapFunc: MapFunc<TIn, TOut, TLogger>,
    config?: MapConfig<TIn, TOut> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, BatchResult<TOut>> {
    const { runIf, rest } = extractConditional(config);
    const taskConfig = this.applyNestingDefault(rest);
    const def = this.makeDef(
      name,
      "map",
      deps,
      runIf,
      taskConfig,
      (ctx, depsMap) => {
        const resolvedItems =
          typeof items === "function"
            ? (items as (d: Record<string, unknown>) => TIn[])(depsMap)
            : items;
        return ctx.runMapWithExplicitId<TIn, TOut>(
          name,
          resolvedItems,
          mapFunc as MapFunc<TIn, TOut, DurableLogger>,
          taskConfig as MapConfig<TIn, TOut> | undefined,
        );
      },
    );
    this.register(name, def);
    return new TaskHandleImpl<TName, BatchResult<TOut>>(name, def.id, def);
  }

  parallel<TName extends string, TDeps extends readonly AnyTaskHandle[], TOut>(
    name: TName,
    deps: TDeps,
    branches: (
      | ParallelFunc<TOut, TLogger>
      | NamedParallelBranch<TOut, TLogger>
    )[],
    config?: ParallelConfig<TOut> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, BatchResult<TOut>>;

  parallel<TName extends string, TOut>(
    name: TName,
    deps: readonly [],
    branches: (
      | ParallelFunc<TOut, TLogger>
      | NamedParallelBranch<TOut, TLogger>
    )[],
    config?: ParallelConfig<TOut> & ConditionalConfig<readonly []>,
  ): TaskHandle<TName, BatchResult<TOut>>;

  parallel<TName extends string, TDeps extends readonly AnyTaskHandle[], TOut>(
    name: TName,
    deps: TDeps,
    branches: (
      | ParallelFunc<TOut, TLogger>
      | NamedParallelBranch<TOut, TLogger>
    )[],
    config?: ParallelConfig<TOut> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, BatchResult<TOut>> {
    const { runIf, rest } = extractConditional(config);
    const taskConfig = this.applyNestingDefault(rest);
    const def = this.makeDef(name, "parallel", deps, runIf, taskConfig, (ctx) =>
      ctx.runParallelWithExplicitId<TOut>(
        name,
        branches as (
          | ParallelFunc<TOut, DurableLogger>
          | NamedParallelBranch<TOut, DurableLogger>
        )[],
        taskConfig as ParallelConfig<TOut> | undefined,
      ),
    );
    this.register(name, def);
    return new TaskHandleImpl<TName, BatchResult<TOut>>(name, def.id, def);
  }

  dag<TName extends string, TDeps extends readonly AnyTaskHandle[]>(
    name: TName,
    deps: TDeps,
    register: (subDagCtx: DagContext<TLogger>) => void | Promise<void>,
    config?: NestedDagConfig & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, DagResult> {
    const { runIf, rest } = extractConditional(config);
    const def = this.makeDef(name, "dag", deps, runIf, rest, (ctx) =>
      ctx.runDagWithExplicitId(
        name,
        register as (dagCtx: DagContext<DurableLogger>) => void | Promise<void>,
        rest as NestedDagConfig | undefined,
      ),
    );
    // Retain the register callback + config so the offloaded-replay reconstruct
    // path can recover the inner task graph and recurse into the inner
    // container's own child checkpoints (nested-offload contract rule 2).
    def.nestedDagRegister = register as (
      dagCtx: DagContext<DurableLogger>,
    ) => void | Promise<void>;
    def.nestedDagConfig = rest as NestedDagConfig | undefined;
    this.register(name, def);
    return new TaskHandleImpl<TName, DagResult>(name, def.id, def);
  }
}
