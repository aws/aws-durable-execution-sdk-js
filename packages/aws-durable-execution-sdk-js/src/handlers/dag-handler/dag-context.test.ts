import { DagContextImpl } from "./dag-context";
import { NestingType } from "../../types/batch";
import type { DurableContextImpl } from "../../context/durable-context/durable-context";
import { DurableLogger } from "../../types/durable-logger";
import { RetryDecision } from "../../types/step";

/**
 * Verifies that the DAG-level {@link DagConfig} `nesting` default is actually
 * threaded into each task's underlying operation config (not silently
 * ignored), and that a task's own value still wins. Also verifies that a
 * per-task `retryStrategy` reaches the underlying step operation, since that
 * is the retry behavior customers rely on.
 */
describe("DagContextImpl config wiring", () => {
  const makeCtx = () => {
    const calls: { method: string; config: unknown }[] = [];
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        // config is always the LAST positional arg of every *WithExplicitId call.
        calls.push({ method, config: args[args.length - 1] });
        return Promise.resolve(undefined);
      };
    const ctx = {
      runStepWithExplicitId: record("step"),
      runCallbackTaskWithExplicitId: record("callback"),
      runMapWithExplicitId: record("map"),
      runParallelWithExplicitId: record("parallel"),
    } as unknown as DurableContextImpl<DurableLogger>;
    return { ctx, calls };
  };

  it("passes a task's own retryStrategy through to the step operation", async () => {
    const own = (): RetryDecision => ({ shouldRetry: true });
    const dag = new DagContextImpl();
    dag.step("s", [], async () => 1, { retryStrategy: own });
    const { ctx, calls } = makeCtx();
    await dag.getTasks()[0].executor(ctx, {});
    expect((calls[0].config as { retryStrategy?: unknown }).retryStrategy).toBe(
      own,
    );
  });

  it("threads nesting default into map and parallel tasks", async () => {
    const dag = new DagContextImpl({ nesting: NestingType.FLAT });
    dag.map("m", [], [1, 2], async () => 0);
    dag.parallel("p", [], [async () => 0]);
    const { ctx, calls } = makeCtx();
    await dag.getTasks()[0].executor(ctx, {});
    await dag.getTasks()[1].executor(ctx, {});
    expect((calls[0].config as { nesting?: unknown }).nesting).toBe(
      NestingType.FLAT,
    );
    expect((calls[1].config as { nesting?: unknown }).nesting).toBe(
      NestingType.FLAT,
    );
  });

  it("does NOT override a task's own nesting", async () => {
    const dag = new DagContextImpl({ nesting: NestingType.FLAT });
    dag.map("m", [], [1], async () => 0, { nesting: NestingType.NESTED });
    const { ctx, calls } = makeCtx();
    await dag.getTasks()[0].executor(ctx, {});
    expect((calls[0].config as { nesting?: unknown }).nesting).toBe(
      NestingType.NESTED,
    );
  });

  it("adds nothing when no defaults are configured", async () => {
    const dag = new DagContextImpl();
    dag.step("s", [], async () => 1);
    const { ctx, calls } = makeCtx();
    await dag.getTasks()[0].executor(ctx, {});
    expect(calls[0].config).toBeUndefined();
  });
});
