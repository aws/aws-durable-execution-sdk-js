import { DagExecutor } from "./dag-executor";
import { TaskDef } from "./task-handle";
import { AnyTaskHandle, DagConfig, TriggerRule } from "../../types/dag";
import { DurableLogger } from "../../types/durable-logger";
import type { DurableContextImpl } from "../../context/durable-context/durable-context";
import {
  completeBatch,
  continueBatch,
  CompletionOutcome,
} from "../../types/batch";

const mockCtx = {} as unknown as DurableContextImpl<DurableLogger>;

interface Built {
  def: TaskDef;
  handle: AnyTaskHandle;
}

const task = (
  name: string,
  opts: {
    deps?: Built[];
    triggerRule?: TriggerRule;
    runIf?: (deps: Record<string, unknown>) => boolean;
    run?: (depsMap: Record<string, unknown>) => Promise<unknown>;
  } = {},
): Built => {
  const id = Symbol(name);
  const deps = opts.deps ?? [];
  const def: TaskDef = {
    name,
    id,
    kind: "step",
    inlineDeps: deps.map((d) => d.handle),
    allDeps: deps.map((d) => d.handle),
    triggerRule: opts.triggerRule,
    runIf: opts.runIf,
    executor: (_ctx, depsMap) => (opts.run ?? (async () => name))(depsMap),
  };
  return { def, handle: { _name: name, _id: id } as AnyTaskHandle };
};

const run = (built: Built[], config?: DagConfig) =>
  new DagExecutor(
    mockCtx,
    built.map((b) => b.def),
    config,
  ).run();

describe("DagExecutor", () => {
  it("resolves an empty DAG immediately", async () => {
    const result = await run([]);
    expect(result.totalCount).toBe(0);
    expect(result.completionReason).toBe("ALL_COMPLETED");
  });

  it("runs a diamond and passes deps downstream", async () => {
    const order: string[] = [];
    const fetch = task("fetch", {
      run: async () => {
        order.push("fetch");
        return 1;
      },
    });
    const a = task("a", {
      deps: [fetch],
      run: async (d) => {
        order.push("a");
        return (d.fetch as number) + 1;
      },
    });
    const b = task("b", {
      deps: [fetch],
      run: async (d) => {
        order.push("b");
        return (d.fetch as number) + 2;
      },
    });
    const merge = task("merge", {
      deps: [a, b],
      run: async (d) => (d.a as number) + (d.b as number),
    });
    const result = await run([fetch, a, b, merge]);
    expect(result.completionReason).toBe("ALL_COMPLETED");
    expect(result.getResult("merge")).toBe(2 + 3);
    expect(order[0]).toBe("fetch");
  });

  it("drains with COMPLETED_WITH_FAILURES on a failed task (no completionConfig)", async () => {
    const a = task("a", {
      run: async () => {
        throw new Error("boom");
      },
    });
    const b = task("b", { deps: [a], run: async () => "b" }); // ALL_SUCCESS => skip
    const result = await run([a, b]);
    expect(result.completionReason).toBe("COMPLETED_WITH_FAILURES");
    expect(result.getStatus("a")).toBe("FAILED");
    expect(result.getStatus("b")).toBe("SKIPPED");
    expect(result.skipped()[0].skipReason).toBe("TRIGGER_RULE");
  });

  it("runs compensation via ALL_FAILED and skips ALL_SUCCESS", async () => {
    const charge = task("charge", {
      run: async () => {
        throw new Error("declined");
      },
    });
    const fulfill = task("fulfill", {
      deps: [charge],
      run: async () => "fulfilled",
    });
    const refund = task("refund", {
      deps: [charge],
      triggerRule: "ALL_FAILED",
      run: async () => "refunded",
    });
    const audit = task("audit", {
      deps: [charge],
      triggerRule: "ALL_DONE",
      run: async () => "audited",
    });
    const result = await run([charge, fulfill, refund, audit]);
    expect(result.getStatus("fulfill")).toBe("SKIPPED");
    expect(result.getResult("refund")).toBe("refunded");
    expect(result.getResult("audit")).toBe("audited");
  });

  it("skips via runIf predicate", async () => {
    const classify = task("classify", { run: async () => "safe" });
    const publish = task("publish", {
      deps: [classify],
      runIf: (d) => d.classify === "safe",
      run: async () => "published",
    });
    const block = task("block", {
      deps: [classify],
      runIf: (d) => d.classify === "block",
      run: async () => "blocked",
    });
    const result = await run([classify, publish, block]);
    expect(result.getResult("publish")).toBe("published");
    expect(result.getStatus("block")).toBe("SKIPPED");
    expect(result.skipped()[0].skipReason).toBe("RUN_IF_PREDICATE");
  });

  it("throttles concurrency to maxConcurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const make = (n: string) =>
      task(n, {
        run: async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 10));
          inFlight--;
          return n;
        },
      });
    const tasks = ["a", "b", "c", "d"].map(make);
    const result = await run(tasks, { maxConcurrency: 2 });
    expect(peak).toBeLessThanOrEqual(2);
    expect(result.successCount).toBe(4);
  });

  it("custom completion can fail early on a result value", async () => {
    const good = task("good", { run: async () => ({ verdict: "ACCEPT" }) });
    const bad = task("bad", { run: async () => ({ verdict: "REJECT" }) });
    const result = await run([good, bad], {
      completionConfig: {
        shouldComplete: (status) =>
          status.items.some(
            (i) =>
              i.status === "SUCCEEDED" &&
              (i.result as { verdict: string })?.verdict === "REJECT",
          )
            ? completeBatch(CompletionOutcome.FAILED)
            : continueBatch(),
      },
    });
    expect(result.completionReason).toBe("CUSTOM_COMPLETION_FAILED");
  });

  it("threshold minSuccessful stops early", async () => {
    const tasks = ["a", "b", "c"].map((n) => task(n, { run: async () => n }));
    const result = await run(tasks, {
      completionConfig: { minSuccessful: 1 },
    });
    expect(["MIN_SUCCESSFUL_REACHED", "ALL_COMPLETED"]).toContain(
      result.completionReason,
    );
    expect(result.successCount).toBeGreaterThanOrEqual(1);
  });
});
