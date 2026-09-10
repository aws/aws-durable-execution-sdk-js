import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { runGraph } from "../runtime/run-graph";
import { StateGraph } from "../builder";
import { StateSchema, appendValue, START, END } from "../schema";

/**
 * Design doc §11 test 7 (Composition) and §4.3.
 *
 * A graph is one operation inside a larger durable workflow — not the whole program. This test
 * runs `runGraph` inside a handler that ALSO has:
 *   - its own `ctx.step("validate", ...)` BEFORE the graph,
 *   - its own `ctx.step("fulfill", ...)` AFTER the graph,
 *   - a `ctx.waitForCallback("review", ...)` wrapping/around the graph run.
 *
 * We assert both the surrounding operations and the graph internals behave: the pre/post steps
 * run exactly once, the surrounding callback suspends and resumes correctly, and the graph's
 * own internal operations (per-tick node paths) are present and produce the right state — all
 * without the parent workflow's steps perturbing graph identity or vice versa.
 */

const runs: Record<string, number> = {};
function recordRun(k: string): void {
  runs[k] = (runs[k] ?? 0) + 1;
}

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

beforeEach(() => {
  for (const k of Object.keys(runs)) {
    delete runs[k];
  }
});

describe("composition: runGraph inside a larger durable workflow", () => {
  // A small deterministic 2-node linear graph — no interrupt inside the graph itself, so the
  // ONLY suspension in this test is the surrounding handler's own waitForCallback.
  const schema = new StateSchema({ steps: appendValue<string>() });
  const innerGraph = new StateGraph(schema, "inner")
    .addNode("first", async (_s, { ctx }) => {
      recordRun("node-first");
      const v = await ctx.step("do-first", async () => "first");
      return { steps: v };
    })
    .addNode("second", async (_s, { ctx }) => {
      recordRun("node-second");
      const v = await ctx.step("do-second", async () => "second");
      return { steps: v };
    })
    .addEdge(START, "first")
    .addEdge("first", "second")
    .addEdge("second", END)
    .compile();

  function buildHandler() {
    return withDurableExecution<{ input: unknown }, unknown>(
      async (event, context: DurableContext) => {
        // 1. A step BEFORE the graph.
        const validated = await context.step("validate", async () => {
          recordRun("validate");
          return "validated";
        });

        // 2. A waitForCallback AROUND the graph: we gate the workflow on a human review, then
        //    run the graph, all inside the same handler.
        const review = await context.waitForCallback<string>(
          "review",
          async () => {},
        );

        const graphState = await runGraph(context, innerGraph, event.input);

        // 3. A step AFTER the graph.
        const fulfilled = await context.step("fulfill", async () => {
          recordRun("fulfill");
          return "fulfilled";
        });

        return {
          validated,
          review,
          fulfilled,
          graphSteps: (graphState as { steps: string[] }).steps,
        };
      },
    );
  }

  it("runs pre-step, surrounding callback, the graph, and post-step correctly", async () => {
    const handler = buildHandler();
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const reviewOp = runner.getOperation<string>("review");
    const executionPromise = runner.run({ payload: { input: {} } });

    // The surrounding callback suspends the whole workflow before the graph runs.
    await reviewOp.waitForData(WaitingOperationStatus.SUBMITTED);
    // The graph must NOT have started while the surrounding callback is pending.
    expect(runs["node-first"] ?? 0).toBe(0);
    expect(runs["node-second"] ?? 0).toBe(0);
    // `validate` ran before the callback; `fulfill` (after the graph) has not.
    expect(runs.validate).toBe(1);
    expect(runs.fulfill ?? 0).toBe(0);

    await reviewOp.sendCallbackSuccess("go");
    const result = await executionPromise;

    expect(result.getResult()).toEqual({
      validated: "validated",
      review: "go",
      fulfilled: "fulfilled",
      graphSteps: ["first", "second"],
    });

    // Each surrounding step ran exactly once across the suspend/resume (replayed, not re-run).
    expect(runs.validate).toBe(1);
    expect(runs.fulfill).toBe(1);
  });

  it("keeps the surrounding operations and the graph internals both addressable in one tree", async () => {
    const handler = buildHandler();
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const reviewOp = runner.getOperation<string>("review");
    const executionPromise = runner.run({ payload: { input: {} } });
    await reviewOp.waitForData(WaitingOperationStatus.SUBMITTED);
    await reviewOp.sendCallbackSuccess("go");
    const result = await executionPromise;

    const names = result
      .getOperations()
      .map((o) => o.getName())
      .filter(Boolean) as string[];

    // Surrounding workflow operations.
    expect(names).toContain("validate");
    expect(names).toContain("review");
    expect(names).toContain("fulfill");
    // Graph-internal operations coexist, rooted under the graph's own context.
    expect(names).toContain("t0/first");
    expect(names).toContain("t1/second");

    // The graph tagged its root/superstep contexts; those subTypes survive the round trip even
    // when nested inside a larger workflow.
    const subTypes = result
      .getOperations()
      .map((o) => o.getSubType() as unknown as string | undefined)
      .filter(Boolean);
    expect(subTypes).toContain("DurableGraph");
    expect(subTypes).toContain("GraphSuperstep");
  });
});
