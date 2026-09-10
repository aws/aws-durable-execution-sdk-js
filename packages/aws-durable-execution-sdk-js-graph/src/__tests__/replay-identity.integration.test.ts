import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { runGraph } from "../runtime/run-graph";
import { compileDurable } from "../runtime/compile-durable";
import { StateGraph } from "../builder";
import { StateSchema, appendValue, lastValue, START, END } from "../schema";
import { interrupt } from "../interrupt";

/**
 * Design doc §11 test 1 (Replay identity) — the subset provable in-process.
 *
 * The strongest form of §11.1 ("kill the invocation between supersteps, resume, assert no node
 * ran twice") cannot be written locally: `LocalDurableTestRunner` cannot force a mid-execution
 * process kill (POC_FINDINGS §8). The genuine cross-invocation replay we CAN drive is an
 * interrupt: the invocation ends at `waitForCallback` and Lambda re-invokes on the callback,
 * replaying every prior superstep from the top. That replay is where a non-idempotent driver
 * would re-run node bodies. We assert it does not.
 *
 * We track node-body executions with a MODULE-LEVEL counter, reset per test. The counter is
 * incremented in the node body *outside* any `ctx.step`, so it counts real body executions
 * across every (re-)invocation — exactly what must not double-count on replay for completed
 * supersteps.
 */

/** Module-level invocation counters, reset in beforeEach. */
const bodyRuns: Record<string, number> = {};
function recordRun(node: string): void {
  bodyRuns[node] = (bodyRuns[node] ?? 0) + 1;
}

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

beforeEach(() => {
  for (const k of Object.keys(bodyRuns)) {
    delete bodyRuns[k];
  }
});

describe("replay identity", () => {
  /**
   * A graph that suspends. `a -> b(interrupt) -> c -> END`. The interrupt in `b` forces a real
   * cross-invocation suspend/resume, so a-and-b's earlier work replays. `a` and `c` wrap a
   * durable step; the body-execution counter lives OUTSIDE the step.
   */
  const schema = new StateSchema({
    trail: appendValue<string>(),
    approved: lastValue<string | null>(null),
  });

  function buildSuspendingGraph() {
    return new StateGraph(schema, "suspending")
      .addNode("a", async (_state, { ctx }) => {
        recordRun("a");
        const v = await ctx.step("work-a", async () => "a");
        return { trail: v };
      })
      .addNode("b", async (_state, nodeCtx) => {
        recordRun("b");
        const decision = await interrupt<string>(
          nodeCtx,
          "approval",
          async () => {},
        );
        return { trail: "b", approved: decision };
      })
      .addNode("c", async (_state, { ctx }) => {
        recordRun("c");
        const v = await ctx.step("work-c", async () => "c");
        return { trail: v };
      })
      .addEdge(START, "a")
      .addEdge("a", "b")
      .addEdge("b", "c")
      .addEdge("c", END)
      .compile();
  }

  it("produces a stable operation tree and runs no node body twice across a suspend/resume", async () => {
    const handler = compileDurable(buildSuspendingGraph());
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const approvalOp = runner.getOperation<string>("approval");
    const executionPromise = runner.run({ payload: { input: {} } });

    // Invocation ends at the interrupt in `b`. Completing the callback triggers a fresh
    // invocation that REPLAYS t0 (`a`) and re-enters t1 (`b`).
    await approvalOp.waitForData(WaitingOperationStatus.SUBMITTED);
    await approvalOp.sendCallbackSuccess("approve");

    const result = await executionPromise;
    const state = result.getResult() as {
      trail: string[];
      approved: string | null;
    };

    // Correct final state — every superstep folded exactly once.
    expect(state.trail).toEqual(["a", "b", "c"]);
    expect(state.approved).toBe("approve");

    // The load-bearing assertion: `a`'s body ran exactly once even though the invocation
    // re-entered from the top after the callback. A non-idempotent driver would show a > 1.
    expect(bodyRuns.a).toBe(1);
    expect(bodyRuns.c).toBe(1);
    // `b` is entered on the first invocation (suspends) and re-entered on resume: at most twice,
    // never more, and its delta lands exactly once (asserted by trail having a single "b").
    expect(bodyRuns.b).toBeGreaterThanOrEqual(1);
    expect(bodyRuns.b).toBeLessThanOrEqual(2);
    expect(state.trail.filter((t) => t === "b")).toHaveLength(1);
  });

  it("keeps the graph's operation tree stable and addressable by structural name", async () => {
    const handler = compileDurable(buildSuspendingGraph());
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const approvalOp = runner.getOperation<string>("approval");
    const executionPromise = runner.run({ payload: { input: {} } });
    await approvalOp.waitForData(WaitingOperationStatus.SUBMITTED);
    await approvalOp.sendCallbackSuccess("approve");
    const result = await executionPromise;

    const ops = result.getOperations();
    const names = ops.map((o) => o.getName()).filter(Boolean) as string[];

    // The structural path is encoded in operation Names (the §6 fallback). Assert the tree
    // contains the expected per-tick node paths and the attestation steps, proving a stable,
    // structurally-addressable tree.
    expect(names).toContain("t0/a");
    expect(names).toContain("t1/b");
    expect(names).toContain("t2/c");
    expect(names).toContain("attest-t0");
    expect(names).toContain("attest-t1");
    expect(names).toContain("attest-t2");
    // The interrupt callback is addressable by its stable local name.
    expect(names).toContain("approval");
  });

  it("replays completed steps without re-executing their bodies (composition around a graph)", async () => {
    // Counter for the *surrounding* handler steps, proving the graph does not perturb the
    // parent workflow's replay identity (design doc §11.7 identity-unaffected clause).
    let preRuns = 0;
    let postRuns = 0;

    const handler = withDurableExecution<{ input: unknown }, unknown>(
      async (event, context: DurableContext) => {
        await context.step("pre", async () => {
          preRuns++;
          return "pre";
        });
        const graphState = await runGraph(
          context,
          buildSuspendingGraph(),
          event.input,
        );
        await context.step("post", async () => {
          postRuns++;
          return "post";
        });
        return {
          trail: (graphState as { trail: string[] }).trail,
        };
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const approvalOp = runner.getOperation<string>("approval");
    const executionPromise = runner.run({ payload: { input: {} } });
    await approvalOp.waitForData(WaitingOperationStatus.SUBMITTED);
    await approvalOp.sendCallbackSuccess("approve");
    const result = await executionPromise;

    expect(result.getResult()).toEqual({ trail: ["a", "b", "c"] });
    // `pre` ran before the interrupt; on the resume invocation it must replay from the
    // checkpoint, NOT re-execute. `post` runs only after resume completes.
    expect(preRuns).toBe(1);
    expect(postRuns).toBe(1);
  });
});
