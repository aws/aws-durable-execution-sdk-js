import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { compileDurable } from "../runtime/compile-durable";
import { StateGraph } from "../builder";
import { StateSchema, appendValue, lastValue, START, END } from "../schema";
import { interrupt } from "../interrupt";

/**
 * Design doc §11 test 4 (Interrupt).
 *
 * Assert two things:
 *   1. While the graph is suspended on `waitForCallback`, NO node body downstream of the
 *      interrupt runs. Suspension is genuinely free — the invocation ends at the interrupt
 *      (design doc §4.6). We prove this with a module-level counter for the downstream node,
 *      checked *while the callback is still SUBMITTED* (before we complete it).
 *   2. Resuming via `sendCallbackSuccess` delivers the value into the node correctly — the
 *      node observes the exact resume payload and folds it into state.
 */

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

describe("interrupt (waitForCallback bridge)", () => {
  // gate(interrupt) -> after -> END. `after` MUST NOT run until the callback is completed.
  const schema = new StateSchema({
    trail: appendValue<string>(),
    decision: lastValue<string | null>(null),
  });

  function buildGatedGraph() {
    return new StateGraph(schema, "gated")
      .addNode("gate", async (_state, nodeCtx) => {
        recordRun("gate");
        const decision = await interrupt<string>(
          nodeCtx,
          "approval",
          async () => {},
        );
        return { trail: "gate", decision };
      })
      .addNode("after", async () => {
        recordRun("after");
        return { trail: "after" };
      })
      .addEdge(START, "gate")
      .addEdge("gate", "after")
      .addEdge("after", END)
      .compile();
  }

  it("suspends on waitForCallback and runs no downstream node body while suspended", async () => {
    const handler = compileDurable(buildGatedGraph());
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const approvalOp = runner.getOperation<string>("approval");
    const executionPromise = runner.run({ payload: { input: {} } });

    // Wait until the callback is SUBMITTED — i.e. the graph is genuinely suspended.
    await approvalOp.waitForData(WaitingOperationStatus.SUBMITTED);

    // WHILE SUSPENDED: the downstream node must not have executed. The invocation ended at the
    // interrupt; nothing beyond the gate node ran.
    expect(bodyRuns.after ?? 0).toBe(0);

    // Now resume; the rest of the graph proceeds.
    await approvalOp.sendCallbackSuccess("approve");
    const result = await executionPromise;

    const state = result.getResult() as {
      trail: string[];
      decision: string | null;
    };
    // After resume, `after` runs exactly once and the trail is complete.
    expect(bodyRuns.after).toBe(1);
    expect(state.trail).toEqual(["gate", "after"]);
    // Resume value delivered into the node and folded into state.
    expect(state.decision).toBe("approve");
  });

  it("delivers the exact resume payload into the interrupted node (approve vs deny)", async () => {
    // Deny path: same graph, different callback value; the node observes it verbatim.
    const handler = compileDurable(buildGatedGraph());
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const approvalOp = runner.getOperation<string>("approval");
    const executionPromise = runner.run({ payload: { input: {} } });
    await approvalOp.waitForData(WaitingOperationStatus.SUBMITTED);
    expect(bodyRuns.after ?? 0).toBe(0);
    await approvalOp.sendCallbackSuccess("deny");
    const result = await executionPromise;

    const state = result.getResult() as { decision: string | null };
    expect(state.decision).toBe("deny");
  });

  it("exposes the interrupt as a WaitForCallback operation addressable by name", async () => {
    const handler = compileDurable(buildGatedGraph());
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const approvalOp = runner.getOperation<string>("approval");
    const executionPromise = runner.run({ payload: { input: {} } });
    await approvalOp.waitForData(WaitingOperationStatus.SUBMITTED);

    // The operation the test grabbed is a genuine waitForCallback (the interrupt bridge).
    expect(approvalOp.isWaitForCallback()).toBe(true);

    await approvalOp.sendCallbackSuccess("approve");
    await executionPromise;
  });
});
