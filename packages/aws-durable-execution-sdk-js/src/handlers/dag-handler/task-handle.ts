import { AnyTaskHandle, TaskHandle, TriggerRule } from "../../types/dag";
import { DurablePromise } from "../../types/durable-promise";
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
  /** inlineDeps ∪ builder `.deps(...)` edges, de-duplicated. Drives scheduling,
   *  readiness, trigger-rule evaluation, cycle detection, and missing-dep checks. */
  allDeps: AnyTaskHandle[];
  triggerRule?: TriggerRule;
  runIf?: (deps: Record<string, unknown>) => boolean;
  options?: unknown;
  /** Runs the underlying operation via an explicit-ID variant. */
  executor: (
    ctx: DurableContextImpl<DurableLogger>,
    depsMap: Record<string, unknown>,
  ) => DurablePromise<unknown>;
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
    readonly _name: TName,
    readonly _id: symbol,
    private readonly _def: TaskDef,
  ) {}

  deps(...deps: readonly AnyTaskHandle[]): this {
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
