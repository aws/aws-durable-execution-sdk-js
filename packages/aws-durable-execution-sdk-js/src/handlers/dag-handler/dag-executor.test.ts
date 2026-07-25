import { DagExecutor, reconstructDagResult } from "./dag-executor";
import { TaskDef } from "./task-handle";
import {
  AnyTaskHandle,
  DagConfig,
  DagSummary,
  TriggerRule,
} from "../../types/dag";
import { DurableLogger } from "../../types/durable-logger";
import type { DurableContextImpl } from "../../context/durable-context/durable-context";
import { ExecutionContext } from "../../types/core";
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
  return { def, handle: { name, _id: id } as AnyTaskHandle };
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

  it("builds the deps map with a null prototype (no inherited keys)", async () => {
    // B3: the deps map is keyed by customer task names, so it must not expose
    // Object.prototype members (or a prototype setter) via those keys.
    let captured: Record<string, unknown> | undefined;
    const up = task("up", { run: async () => "v" });
    const down = task("down", {
      deps: [up],
      run: async (d) => {
        captured = d;
        return "d";
      },
    });
    await run([up, down]);
    expect(captured).toBeDefined();
    expect(Object.getPrototypeOf(captured!)).toBeNull();
    // No inherited keys are reachable (on a plain {} these would be truthy).
    expect(captured!["__proto__"]).toBeUndefined();
    expect(captured!["constructor"]).toBeUndefined();
    expect(captured!["toString"]).toBeUndefined();
    // Declared deps still resolve.
    expect(captured!.up).toBe("v");
  });
});

describe("DagExecutor trigger-rule / skip edges", () => {
  it("skips a root task with a failure-family rule (empty upstream)", async () => {
    const root = task("root", { triggerRule: "ALL_FAILED" });
    const r = await run([root]);
    expect(r.getStatus("root")).toBe("SKIPPED");
    expect(r.skipped()[0].skipReason).toBe("TRIGGER_RULE");
    expect(r.completionReason).toBe("ALL_COMPLETED");
  });

  it("runs success/done-family root rules on empty upstream, skips one-family", async () => {
    const a = task("a", { triggerRule: "ALL_DONE" });
    const b = task("b", { triggerRule: "NONE_FAILED" });
    const c = task("c", { triggerRule: "ANY_SUCCESS" });
    const r = await run([a, b, c]);
    expect(r.getStatus("a")).toBe("SUCCEEDED");
    expect(r.getStatus("b")).toBe("SUCCEEDED");
    expect(r.getStatus("c")).toBe("SKIPPED");
  });

  it("cascades skips but still runs an ALL_DONE sink", async () => {
    const root = task("root", { triggerRule: "ALL_FAILED" }); // skips
    const mid = task("mid", { deps: [root] }); // ALL_SUCCESS => skip
    const sink = task("sink", { deps: [mid], triggerRule: "ALL_DONE" }); // runs
    const r = await run([root, mid, sink]);
    expect(r.getStatus("root")).toBe("SKIPPED");
    expect(r.getStatus("mid")).toBe("SKIPPED");
    expect(r.getStatus("sink")).toBe("SUCCEEDED");
  });

  it("ANY_SUCCESS runs on a mix of one success + one failure", async () => {
    const ok = task("ok", { run: async () => "ok" });
    const bad = task("bad", {
      run: async () => {
        throw new Error("x");
      },
    });
    const sink = task("sink", {
      deps: [ok, bad],
      triggerRule: "ANY_SUCCESS",
      run: async () => "ran",
    });
    const r = await run([ok, bad, sink]);
    expect(r.getStatus("sink")).toBe("SUCCEEDED");
    expect(r.completionReason).toBe("COMPLETED_WITH_FAILURES");
  });

  it("custom completion continue() drains the whole graph", async () => {
    const a = task("a", { run: async () => 1 });
    const b = task("b", { run: async () => 2 });
    const r = await run([a, b], {
      completionConfig: { shouldComplete: () => continueBatch() },
    });
    expect(r.completionReason).toBe("ALL_COMPLETED");
    expect(r.successCount).toBe(2);
  });
});

describe("reconstructDagResult (design-B replay)", () => {
  const rcCtx = {
    createTaskId: (name: string) => `1-2-DAG_NODE_T_${name}`,
  } as unknown as DurableContextImpl<DurableLogger>;

  const handleOf = (def: TaskDef): AnyTaskHandle =>
    ({ name: def.name, _id: def.id }) as AnyTaskHandle;
  const mk = (
    name: string,
    deps: TaskDef[] = [],
    triggerRule?: TriggerRule,
  ): TaskDef => ({
    name,
    id: Symbol(name),
    kind: "step",
    inlineDeps: deps.map(handleOf),
    allDeps: deps.map(handleOf),
    triggerRule,
    executor: async () => undefined,
  });
  const execCtxWith = (
    data: Record<string, { Status: string; result?: unknown }>,
  ): ExecutionContext =>
    ({
      getStepData: (id: string) => {
        const d = data[id];
        if (!d) return undefined;
        return {
          Status: d.Status,
          StepDetails:
            d.result !== undefined
              ? { Result: JSON.stringify(d.result) }
              : undefined,
        };
      },
    }) as unknown as ExecutionContext;
  const envelope = (over: Partial<DagSummary>): DagSummary => ({
    type: "DagResult",
    totalCount: 0,
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
    completedCount: 0,
    completionReason: "ALL_COMPLETED",
    startedTaskNames: [],
    terminalTaskNames: [],
    ...over,
  });

  it("reconstructs succeeded results and recomputes trigger-rule skips", async () => {
    const a = mk("a");
    const b = mk("b", [a]);
    const c = mk("c", [a], "ALL_FAILED"); // a succeeded => c skips
    const exec = execCtxWith({
      "1-2-DAG_NODE_T_a": { Status: "SUCCEEDED", result: 10 },
      "1-2-DAG_NODE_T_b": { Status: "SUCCEEDED", result: 20 },
    });
    const r = await reconstructDagResult(
      rcCtx,
      [a, b, c],
      envelope({
        totalCount: 3,
        successCount: 2,
        skippedCount: 1,
        completedCount: 3,
        completionReason: "ALL_COMPLETED",
        terminalTaskNames: ["a", "b", "c"],
      }),
      exec,
    );
    expect(r.getResult("a")).toBe(10);
    expect(r.getResult("b")).toBe(20);
    expect(r.getStatus("c")).toBe("SKIPPED");
    expect(r.skipped()[0].skipReason).toBe("TRIGGER_RULE");
    expect(r.totalCount).toBe(3);
  });

  it("leaves a skip-eligible task ABSENT when the envelope excludes it (early completion)", async () => {
    // Repro for the design-B replay-fidelity bug: under early completion the
    // live scheduler halts on the completing settle BEFORE the skip pass, so a
    // skip-eligible task downstream of the completing task is ABSENT live.
    // Reconstruction must NOT re-materialize it as SKIPPED, and must source
    // counts from the (authoritative) envelope rather than recomputing.
    const a = mk("a");
    const c = mk("c", [a], "ALL_FAILED"); // a SUCCEEDED => c would greedily skip
    const exec = execCtxWith({
      "1-2-DAG_NODE_T_a": { Status: "SUCCEEDED", result: 1 },
    });
    const r = await reconstructDagResult(
      rcCtx,
      [a, c],
      envelope({
        totalCount: 2,
        successCount: 1,
        skippedCount: 0,
        completedCount: 1,
        completionReason: "MIN_SUCCESSFUL_REACHED",
        terminalTaskNames: ["a"], // c is NOT terminal — it never started
      }),
      exec,
    );
    expect(r.getStatus("a")).toBe("SUCCEEDED");
    // Regression guard: c must stay ABSENT, not SKIPPED.
    expect(r.getStatus("c")).toBeUndefined();
    // Counts come from the envelope, not a divergent recompute.
    expect(r.successCount).toBe(1);
    expect(r.skippedCount).toBe(0);
    expect(r.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
  });

  it("recovers the STARTED set; downstream of STARTED stays never-started (absent)", async () => {
    const a = mk("a");
    const b = mk("b");
    const c = mk("c", [b]); // b in-flight at early completion => c never started
    const exec = execCtxWith({
      "1-2-DAG_NODE_T_a": { Status: "SUCCEEDED", result: 1 },
    });
    const r = await reconstructDagResult(
      rcCtx,
      [a, b, c],
      envelope({
        totalCount: 3,
        successCount: 1,
        completedCount: 1,
        completionReason: "MIN_SUCCESSFUL_REACHED",
        startedTaskNames: ["b"],
        terminalTaskNames: ["a"],
      }),
      exec,
    );
    expect(r.getStatus("a")).toBe("SUCCEEDED");
    expect(r.getStatus("b")).toBe("STARTED");
    // Regression guard: c must NOT be skipped against b's non-terminal STARTED.
    expect(r.getStatus("c")).toBeUndefined();
    expect(r.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
  });

  it("reconstructs FAILED tasks and reports COMPLETED_WITH_FAILURES by default", async () => {
    const a = mk("a");
    const exec = execCtxWith({
      "1-2-DAG_NODE_T_a": { Status: "FAILED" },
    });
    const r = await reconstructDagResult(rcCtx, [a], null, exec);
    expect(r.getStatus("a")).toBe("FAILED");
    expect(r.completionReason).toBe("COMPLETED_WITH_FAILURES");
  });

  it("startedSet takes precedence over a checkpoint (envelope is authoritative)", async () => {
    // H4: a task in-flight at early completion is recorded STARTED live, listed
    // in the envelope's startedTaskNames, and EXCLUDED from the authoritative
    // counts — but its underlying op may have checkpointed SUCCEEDED before the
    // invocation unwound. Reconstruction must honor the envelope and report
    // STARTED, not SUCCEEDED, so the results map agrees with the counts.
    const a = mk("a");
    const b = mk("b", [a]);
    const exec = execCtxWith({
      "1-2-DAG_NODE_T_a": { Status: "SUCCEEDED", result: 1 },
      "1-2-DAG_NODE_T_b": { Status: "SUCCEEDED", result: 2 }, // checkpointed...
    });
    const r = await reconstructDagResult(
      rcCtx,
      [a, b],
      envelope({
        totalCount: 2,
        successCount: 1, // b is NOT counted as a success
        completedCount: 1,
        completionReason: "MIN_SUCCESSFUL_REACHED",
        startedTaskNames: ["b"], // ...but authoritatively STARTED
        terminalTaskNames: ["a"],
      }),
      exec,
    );
    expect(r.getStatus("a")).toBe("SUCCEEDED");
    // Regression guard: checkpoint says SUCCEEDED, envelope says STARTED — the
    // envelope wins.
    expect(r.getStatus("b")).toBe("STARTED");
    expect(r.getResult("b")).toBeUndefined();
    expect(r.successCount).toBe(1);
  });
});
