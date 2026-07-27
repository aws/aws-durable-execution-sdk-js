import {
  DEFAULT_DAG_MAX_CONCURRENCY,
  DagExecutor,
  reconstructDagResult,
} from "./dag-executor";
import { DagPredicateError } from "../../errors/durable-error/durable-error";
import { TaskDef } from "./task-handle";
import {
  AnyTaskHandle,
  DagConfig,
  DagResultEnvelope,
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

  it("aborts the DAG with DagPredicateError when a runIf predicate throws", async () => {
    const original = new Error("predicate boom");
    const scheduled: string[] = [];
    const gate = task("gate", { run: async () => "g" });
    // Offending task: its runIf throws once `gate` resolves.
    const decide = task("decide", {
      deps: [gate],
      runIf: () => {
        throw original;
      },
      run: async () => {
        scheduled.push("decide");
        return "decided";
      },
    });
    // Downstream compensation: MUST NOT fire off a predicate defect.
    const refund = task("refund", {
      deps: [decide],
      triggerRule: "ALL_FAILED",
      run: async () => {
        scheduled.push("refund");
        return "refunded";
      },
    });
    const executor = new DagExecutor(
      mockCtx,
      [gate, decide, refund].map((b) => b.def),
    );

    let caught: unknown;
    await executor.run().catch((e) => {
      caught = e;
    });

    // (1) rejects with the typed error naming the offending task
    expect(caught).toBeInstanceOf(DagPredicateError);
    const err = caught as DagPredicateError;
    expect(err.taskName).toBe("decide");
    // (2) cause is the original error, unwrapped
    expect(err.cause).toBe(original);
    // (2b) the message names both the task and the cause's type/message, so a
    // customer reading it past the (lossy) container boundary still learns
    // which predicate threw and what it threw.
    expect(err.message).toBe(
      'runIf predicate for DAG task "decide" threw Error: predicate boom',
    );

    // (3) the offending task has NO terminal state (neither FAILED nor SKIPPED)
    const results = (
      executor as unknown as { results: Map<string, { status: string }> }
    ).results;
    expect(results.has("decide")).toBe(false);

    // (4) no downstream ALL_FAILED task was scheduled, and the offending
    // task's own body never ran
    expect(scheduled).toEqual([]);
    expect(results.has("refund")).toBe(false);
  });

  it("non-root throwing runIf aborts WITHOUT leaking an unhandled rejection (H5 cloud regression)", async () => {
    // The 10-12 cloud defect: `guarded`'s runIf depends on `gate`, so it is
    // evaluated in a `.then` continuation after `gate` settles — on the
    // scheduler's DETACHED task promise, a chain the container body never
    // awaits. A throw there must fail the DAG on the run() promise, NOT escape
    // as an unhandled rejection to the runtime (which the cloud reported as
    // `Runtime.UnhandledPromiseRejection` with the raw `Error: predicate boom`,
    // Lambda retrying and the container never marked failed).
    //
    // This distinguishes "the DAG aborted" (run() rejects) from "the error
    // escaped to the runtime" (an unhandled rejection): merely asserting that
    // run() rejects is not enough, because the escape happens on a SEPARATE
    // detached promise while run() may still reject.
    const unhandled: unknown[] = [];
    const onUnhandled = (r: unknown): void => {
      unhandled.push(r);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const original = new Error("predicate boom");
      // `gate` resolves after a microtask so its settlement — and therefore the
      // predicate evaluation — runs in a continuation, not the first pass.
      const gate = task("gate", {
        run: async () => {
          await Promise.resolve();
          return "g";
        },
      });
      const guarded = task("guarded", {
        deps: [gate],
        runIf: () => {
          throw original;
        },
        run: async () => "ran",
      });

      let caught: unknown;
      await run([gate, guarded]).catch((e) => {
        caught = e;
      });
      // Flush the microtask + macrotask queues so any leaked rejection would be
      // surfaced by the process listener before we assert.
      await new Promise((r) => setTimeout(r, 20));

      expect(caught).toBeInstanceOf(DagPredicateError);
      expect((caught as DagPredicateError).taskName).toBe("guarded");
      expect((caught as DagPredicateError).cause).toBe(original);
      // The distinguishing assertion: nothing escaped to the runtime.
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("converts ANY scheduling-time throw in a continuation into a DAG abort (structural guard, not just runIf)", async () => {
    // Defense-in-depth for the exact escape hatch above: the point try/catch on
    // runIf only converts that one throw site. The scheduler runs on a detached
    // promise, so ANY other scheduling-time throw in a settlement continuation
    // would likewise escape (or hang run() forever). Here a downstream task is
    // made ready in a continuation with an unknown trigger rule, so
    // `triggerRuleEvaluators[rule]` is undefined and the scheduler throws inside
    // the detached promise. The terminal `.catch` must convert it into an
    // abort so run() rejects deterministically and nothing escapes.
    const unhandled: unknown[] = [];
    const onUnhandled = (r: unknown): void => {
      unhandled.push(r);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const up = task("up", {
        run: async () => {
          await Promise.resolve();
          return "u";
        },
      });
      const down = task("down", {
        deps: [up],
        triggerRule: "NOT_A_REAL_RULE" as unknown as TriggerRule,
        run: async () => "d",
      });

      let caught: unknown;
      await run([up, down]).catch((e) => {
        caught = e;
      });
      await new Promise((r) => setTimeout(r, 20));

      // run() rejected (the container is failed) rather than hanging, and
      // nothing escaped to the runtime.
      expect(caught).toBeDefined();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("wraps a non-Error thrown from runIf as the DagPredicateError cause", async () => {
    const gate = task("gate", { run: async () => "g" });
    const decide = task("decide", {
      deps: [gate],
      runIf: () => {
        throw "not-an-error";
      },
      run: async () => "decided",
    });
    const executor = new DagExecutor(
      mockCtx,
      [gate, decide].map((b) => b.def),
    );

    let caught: unknown;
    await executor.run().catch((e) => {
      caught = e;
    });
    expect(caught).toBeInstanceOf(DagPredicateError);
    const err = caught as DagPredicateError;
    expect(err.cause).toBeInstanceOf(Error);
    expect(err.cause?.message).toBe("not-an-error");
    // A non-Error throw is coerced to Error, so the message names its type
    // (Error) and the stringified value.
    expect(err.message).toBe(
      'runIf predicate for DAG task "decide" threw Error: not-an-error',
    );
  });

  it("aborts on a throwing runIf evaluated on the first scheduling pass (no upstream)", async () => {
    const original = new Error("boom on first pass");
    const solo = task("solo", {
      runIf: () => {
        throw original;
      },
      run: async () => "ran",
    });
    const executor = new DagExecutor(mockCtx, [solo.def]);

    let caught: unknown;
    await executor.run().catch((e) => {
      caught = e;
    });
    expect(caught).toBeInstanceOf(DagPredicateError);
    expect((caught as DagPredicateError).taskName).toBe("solo");
    expect((caught as DagPredicateError).cause).toBe(original);
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

  describe("default maxConcurrency", () => {
    // Instrumented top-level tasks that observe the true simultaneous in-flight
    // count. Each holds its slot across an awaited macrotask so the scheduler's
    // cap is exercised at a real peak rather than a synchronous fall-through.
    const makeGraph = (
      count: number,
    ): { tasks: Built[]; state: { inFlight: number; peak: number } } => {
      const state = { inFlight: 0, peak: 0 };
      const tasks = Array.from(
        { length: count },
        (_, i): Built =>
          task(`t${i}`, {
            run: async (): Promise<number> => {
              state.inFlight += 1;
              state.peak = Math.max(state.peak, state.inFlight);
              await new Promise((r) => setTimeout(r, 5));
              state.inFlight -= 1;
              return i;
            },
          }),
      );
      return { tasks, state };
    };

    it("caps a graph wider than 40 at 40 in flight when unset (peak observed)", async () => {
      // Sensitive test: 100 independent top-level tasks, no maxConcurrency.
      // Assert the OBSERVED simultaneous peak — not a config value — never
      // exceeds 40. If the default regressed to unbounded, peak would climb to
      // 100 and this fails.
      const { tasks, state } = makeGraph(100);
      const result = await run(tasks);
      expect(result.successCount).toBe(100);
      expect(state.peak).toBeLessThanOrEqual(DEFAULT_DAG_MAX_CONCURRENCY);
      // And the bound genuinely binds: with 100 ready tasks the scheduler
      // should saturate the cap, so the peak must actually reach 40. A peak
      // well below 40 would mean the cap wasn't the thing limiting overlap.
      expect(state.peak).toBe(DEFAULT_DAG_MAX_CONCURRENCY);
    });

    it("an explicit value BELOW 40 still wins over the default", async () => {
      const { tasks, state } = makeGraph(60);
      const result = await run(tasks, { maxConcurrency: 5 });
      expect(result.successCount).toBe(60);
      expect(state.peak).toBeLessThanOrEqual(5);
      expect(state.peak).toBe(5);
    });

    it("an explicit value ABOVE 40 still wins over the default", async () => {
      const { tasks, state } = makeGraph(80);
      const result = await run(tasks, { maxConcurrency: 60 });
      expect(result.successCount).toBe(80);
      // The default (40) must NOT clamp an explicit larger bound: the peak is
      // free to exceed 40, proving the default did not silently win.
      expect(state.peak).toBeGreaterThan(DEFAULT_DAG_MAX_CONCURRENCY);
      expect(state.peak).toBeLessThanOrEqual(60);
    });

    it("a graph no wider than 40 is unaffected by the default", async () => {
      const { tasks, state } = makeGraph(6);
      const result = await run(tasks);
      expect(result.successCount).toBe(6);
      // All 6 can run at once; 40 never binds (mirrors conformance 10-13/10-14).
      expect(state.peak).toBe(6);
    });
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
  const envelope = (over: Partial<DagResultEnvelope>): DagResultEnvelope => ({
    type: "DagResult",
    totalCount: 0,
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
    completionReason: "ALL_COMPLETED",
    startedTaskNames: [],
    failedTaskNames: [],
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
        completionReason: "ALL_COMPLETED",
        failedTaskNames: [],
      }),
      exec,
    );
    expect(r.getResult("a")).toBe(10);
    expect(r.getResult("b")).toBe(20);
    expect(r.getStatus("c")).toBe("SKIPPED");
    expect(r.skipped()[0].skipReason).toBe("TRIGGER_RULE");
    expect(r.totalCount).toBe(3);
  });

  it("rejects with DagPredicateError if a runIf throws while recomputing a skip on replay", async () => {
    // A no-checkpoint, envelope-terminal task forces computeSkipReason to
    // re-evaluate runIf. A faithful replay of a SUCCEEDED container can never
    // reach this with a throwing predicate (it would have aborted live), so a
    // throw here signals non-determinism and must surface as the same typed
    // error rather than being masked as SKIPPED.
    const a = mk("a");
    const original = new Error("non-deterministic predicate");
    const gate: TaskDef = {
      ...mk("gate", [a]),
      runIf: () => {
        throw original;
      },
    };
    const exec = execCtxWith({
      "1-2-DAG_NODE_T_a": { Status: "SUCCEEDED", result: 1 },
      // no checkpoint for "gate"
    });
    await expect(
      reconstructDagResult(
        rcCtx,
        [a, gate],
        envelope({
          totalCount: 2,
          successCount: 1,
          skippedCount: 1,
        }),
        exec,
      ),
    ).rejects.toBeInstanceOf(DagPredicateError);
  });

  it("recomputes a downstream skip greedily once terminalTaskNames is gone (convergence tradeoff)", async () => {
    // CONVERGENCE NOTE. The cross-language envelope contract drops
    // `terminalTaskNames`. That field was the ONLY signal that distinguished,
    // on the offloaded replay path, a task that was SKIPPED live from one that
    // was never started because early completion halted the scheduler before
    // its skip pass. Without it, reconstruction recomputes skip/trigger
    // decisions deterministically (the contract's stated replay rule), which
    // materializes a skip-eligible task downstream of a TERMINAL task as
    // SKIPPED — even if, under early completion, the live run left it absent.
    //
    // This is an accepted tradeoff, not a silent bug: the counts and
    // completionReason are still sourced from the (authoritative) envelope, so
    // the aggregate the console renders stays correct; only the per-task map
    // may carry an extra skip in the narrow offload + early-completion case.
    const a = mk("a");
    const c = mk("c", [a], "ALL_FAILED"); // a SUCCEEDED => c greedily skips
    const exec = execCtxWith({
      "1-2-DAG_NODE_T_a": { Status: "SUCCEEDED", result: 1 },
    });
    const r = await reconstructDagResult(
      rcCtx,
      [a, c],
      envelope({
        totalCount: 2,
        successCount: 1,
        skippedCount: 0, // envelope-authoritative: live never counted c
        completionReason: "MIN_SUCCESSFUL_REACHED",
      }),
      exec,
    );
    expect(r.getStatus("a")).toBe("SUCCEEDED");
    // Greedy recompute now materializes c as SKIPPED (was ABSENT under the old
    // terminalTaskNames-carrying envelope).
    expect(r.getStatus("c")).toBe("SKIPPED");
    // Counts remain envelope-authoritative, NOT a recompute over the map.
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
        completionReason: "MIN_SUCCESSFUL_REACHED",
        startedTaskNames: ["b"],
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
        completionReason: "MIN_SUCCESSFUL_REACHED",
        startedTaskNames: ["b"], // ...but authoritatively STARTED
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
