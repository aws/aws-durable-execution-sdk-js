import { DagContextImpl } from "./dag-context";
import { BatchResult } from "../../types/batch";
import { DurableContext } from "../../types/durable-context";
import { DurableLogger } from "../../types/durable-logger";
import {
  StepContext,
  WaitForCallbackContext,
  WaitForConditionContext,
} from "../../types/logger";
import { DagResult, TaskHandle } from "../../types/dag";

/**
 * Type-level guard for the per-task-kind argument-order rule (`DAG_SPEC.md`
 * §4.1): when a task has no deps its callback keeps the underlying operation's
 * native signature, and when it has deps `deps` is prepended.
 *
 * The generic signatures express that with a conditional type keyed on
 * `TDeps extends readonly []`, which is NOT enough on its own: a bare `[]`
 * argument is widened to an array type rather than inferred as the empty tuple,
 * so the conditional resolves to the deps-bearing branch and the native shape
 * is either rejected outright (`waitForCondition`, whose native first parameter
 * is `state`) or silently mis-typed (kinds whose native callback simply has
 * fewer parameters, where the context parameter would be typed as the deps map).
 * Each kind therefore carries an explicit `deps: readonly []` overload. These
 * assertions fail at compile time — via `tsc` and via ts-jest — if an overload
 * is dropped or reordered.
 *
 * Note the deps-bearing callbacks below annotate their return type, as the
 * conformance handlers and examples do: a conditional-typed callback parameter
 * is not an inference site for the result type, so `TResult` would otherwise
 * widen to `unknown`. That is pre-existing and independent of these overloads.
 */
describe("DagContext task-kind callback typing", () => {
  const assignable = <T>(_value: T): void => {};

  it("gives no-deps tasks their native callback signature", () => {
    const d = new DagContextImpl();

    // Each callback annotates its parameter with the NATIVE type. If the
    // no-deps overload were missing, the first parameter would be the deps map
    // and every one of these would fail to compile.
    const step = d.step(
      "step",
      [],
      async (ctx: StepContext<DurableLogger>): Promise<number> => {
        assignable<StepContext<DurableLogger>>(ctx);
        return 1;
      },
    );
    const child = d.runInChildContext(
      "child",
      [],
      async (ctx: DurableContext<DurableLogger>): Promise<string> => {
        assignable<DurableContext<DurableLogger>>(ctx);
        return "child";
      },
    );
    const poll = d.waitForCondition(
      "poll",
      [],
      async (
        state: number,
        ctx: WaitForConditionContext<DurableLogger>,
      ): Promise<number> => {
        assignable<WaitForConditionContext<DurableLogger>>(ctx);
        return state + 1;
      },
      { initialState: 0, waitStrategy: () => ({ shouldContinue: false }) },
    );
    const cb = d.callback(
      "cb",
      [],
      async (
        callbackId: string,
        ctx: WaitForCallbackContext<DurableLogger>,
      ): Promise<void> => {
        assignable<string>(callbackId);
        assignable<WaitForCallbackContext<DurableLogger>>(ctx);
      },
    );
    const call = d.invoke<"call", number, number>(
      "call",
      "fn:prod",
      [],
      () => 1,
    );
    const items = d.map(
      "items",
      [],
      [1, 2],
      async (
        ctx: DurableContext<DurableLogger>,
        item: number,
      ): Promise<number> => {
        assignable<DurableContext<DurableLogger>>(ctx);
        return item * 2;
      },
    );
    const branches = d.parallel(
      "branches",
      [],
      [async (): Promise<string> => "L"],
    );
    const sub = d.dag("sub", [], () => {});

    // Result types still flow through the overloads.
    assignable<TaskHandle<"step", number>>(step);
    assignable<TaskHandle<"child", string>>(child);
    assignable<TaskHandle<"poll", number>>(poll);
    assignable<TaskHandle<"cb", string>>(cb);
    assignable<TaskHandle<"call", number>>(call);
    assignable<TaskHandle<"items", BatchResult<number>>>(items);
    assignable<TaskHandle<"branches", BatchResult<string>>>(branches);
    assignable<TaskHandle<"sub", DagResult>>(sub);
  });

  it("prepends a typed deps map when a task has deps", () => {
    const d = new DagContextImpl();

    const root = d.step("root", [], async (): Promise<number> => 10);
    const withDeps = d.step(
      "withDeps",
      [root],
      async (deps, ctx): Promise<number> => {
        // A dependency's result is `R | undefined` (present only when the
        // upstream SUCCEEDED); narrow before use.
        assignable<number | undefined>(deps.root);
        assignable<StepContext<DurableLogger>>(ctx);
        return (deps.root ?? 0) + 1;
      },
    );
    const childWithDeps = d.runInChildContext(
      "childWithDeps",
      [root, withDeps],
      async (deps, ctx): Promise<string> => {
        assignable<number | undefined>(deps.root);
        assignable<number | undefined>(deps.withDeps);
        assignable<DurableContext<DurableLogger>>(ctx);
        return `${deps.root}`;
      },
    );

    assignable<TaskHandle<"withDeps", number>>(withDeps);
    assignable<TaskHandle<"childWithDeps", string>>(childWithDeps);

    d.waitForCondition(
      "pollWithDeps",
      [root],
      async (deps, state: number): Promise<number> => (deps.root ?? 0) + state,
      { initialState: 0, waitStrategy: () => ({ shouldContinue: false }) },
    );
    d.callback(
      "cbWithDeps",
      [root],
      async (deps, callbackId): Promise<void> => {
        assignable<number | undefined>(deps.root);
        assignable<string>(callbackId);
      },
    );
    d.invoke("callWithDeps", "fn:prod", [root], (deps) => deps.root ?? 0);
    d.map(
      "itemsWithDeps",
      [root],
      (deps) => [deps.root ?? 0],
      async (_ctx, item: number): Promise<number> => item * 2,
    );
  });

  it("rejects dep keys that were not declared", () => {
    const d = new DagContextImpl();
    const root = d.step("root", [], async (): Promise<number> => 10);

    d.step("bad", [root], async (deps): Promise<number> => {
      // @ts-expect-error `other` is not among this task's declared deps.
      const value: number = deps.other;
      return value;
    });
  });

  it("types a dependency's result as `R | undefined` (present only on upstream SUCCESS)", () => {
    // A compensation/cleanup task under a non-`ALL_SUCCESS` trigger rule (here
    // `ALL_DONE`) can run while an upstream dependency FAILED or was SKIPPED,
    // in which case that dependency's result is `undefined` at runtime
    // (`dag-executor.ts` `buildDepsMap`). The type must reflect that: reading
    // the value without narrowing is a compile error, and the narrowed value
    // is the declared result type.
    const d = new DagContextImpl();

    // `flaky` is designed to fail at runtime; its declared result type is still
    // `number`, so downstream deps see `number | undefined`.
    const flaky = d.step("flaky", [], async (): Promise<number> => {
      throw new Error("boom");
    });

    d.step("audit", [flaky], async (deps): Promise<number> => {
      // The honest type: the upstream result may be absent.
      assignable<number | undefined>(deps.flaky);

      // @ts-expect-error `deps.flaky` is `number | undefined`; must narrow
      // before using it as a `number` (this is exactly the footgun the fix
      // surfaces at compile time).
      const unsafe: number = deps.flaky;
      void unsafe;

      // Narrowing (nullish coalescing / truthy check / optional chaining)
      // yields the declared result type, so compensation logic still works.
      const safe: number = deps.flaky ?? -1;
      return safe;
    }).triggerRule("ALL_DONE");
  });
});
