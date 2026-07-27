import {
  AnyTaskHandle,
  DagContext,
  NestedDagConfig,
  TaskHandle,
  TriggerRule,
} from "../../types/dag";
import { DurableLogger } from "../../types/durable-logger";
import type { DurableContextImpl } from "../../context/durable-context/durable-context";

/**
 * The operation kind backing a DAG task.
 * @internal
 */
export type TaskKind =
  | "step"
  | "invoke"
  | "callback"
  | "wait"
  | "waitForCondition"
  | "runInChildContext"
  | "map"
  | "parallel"
  | "dag";

/**
 * Internal definition of a registered DAG task. Created by `DagContextImpl`
 * during registration and mutated by the {@link TaskHandleImpl} builder.
 *
 * @internal
 */
export interface TaskDef {
  name: string;
  /** In-memory identity shared with the returned {@link TaskHandleImpl}. */
  id: symbol;
  kind: TaskKind;
  /** Inline deps only (from the `deps` argument). Drives DepsMap construction. */
  inlineDeps: readonly AnyTaskHandle[];
  /** inlineDeps ∪ builder `.after(...)` edges, de-duplicated. Drives scheduling,
   *  readiness, trigger-rule evaluation, cycle detection, and missing-dep checks. */
  allDeps: AnyTaskHandle[];
  triggerRule?: TriggerRule;
  runIf?: (deps: Record<string, unknown>) => boolean;
  options?: unknown;
  /** Runs the underlying operation via an explicit-ID variant. */
  executor: (
    ctx: DurableContextImpl<DurableLogger>,
    depsMap: Record<string, unknown>,
  ) => Promise<unknown>;
  /**
   * For a nested `dag` task ONLY: the registration callback and its config,
   * retained so the offloaded-replay reconstruct path can re-run the inner
   * `register` to recover the inner task graph and recurse into the inner
   * container's own child checkpoints (nested-offload contract rule 2).
   *
   * Without this the register callback is captured only inside `executor`'s
   * closure and is unreachable from `reconstructDagResult`, so an offloaded
   * (tasks-less) inner envelope could be restored to honest aggregates but an
   * empty per-task map. `register` is a deterministic, declarative callback, so
   * re-running it on replay reproduces the same graph the live run built.
   */
  nestedDagRegister?: (
    dagCtx: DagContext<DurableLogger>,
  ) => void | Promise<void>;
  nestedDagConfig?: NestedDagConfig;
}

/**
 * Registration-time reference to a DAG task, and a chainable builder for
 * ordering-only dependencies and the trigger rule. Mutates the backing
 * {@link TaskDef}. Never serialized.
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class TaskHandleImpl<
  TName extends string = string,
  TResult = unknown,
> implements TaskHandle<TName, TResult> {
  readonly _resultType?: TResult;

  constructor(
    readonly name: TName,
    readonly _id: symbol,
    private readonly _def: TaskDef,
  ) {}

  after(...deps: readonly AnyTaskHandle[]): this {
    for (const dep of deps) {
      if (!this._def.allDeps.some((existing) => existing._id === dep._id)) {
        this._def.allDeps.push(dep);
      }
    }
    return this;
  }

  triggerRule(rule: TriggerRule): this {
    this._def.triggerRule = rule;
    return this;
  }
}
