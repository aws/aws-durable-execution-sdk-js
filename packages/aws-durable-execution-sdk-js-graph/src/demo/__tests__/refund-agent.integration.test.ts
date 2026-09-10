import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { runGraph } from "../../runtime/run-graph";
import { compileDurable } from "../../runtime/compile-durable";
import { refundGraph, DemoMessage } from "../../demo";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

/**
 * End-to-end demo: the refund-approval agent (design doc Appendix A) driven by the durable
 * superstep driver, with a FAKE model and a real `waitForCallback` interrupt. Hermetic — no
 * network. Proves the load-bearing question of Phase 1: does the superstep driver model hold
 * on positional ids?
 */
describe("refund-approval demo graph", () => {
  const initialInput = {
    messages: {
      role: "user",
      content: "Please refund order A-91.",
    } as DemoMessage,
  };

  it("runs the full agent loop through an approved interrupt to a final answer", async () => {
    const handler = compileDurable(refundGraph);
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    // Register interest in the interrupt callback BEFORE run() (canonical pattern).
    const approvalOp = runner.getOperation<string>("approval");

    const executionPromise = runner.run({ payload: { input: initialInput } });

    // The invocation suspends at the refund approval; complete it with "approve".
    await approvalOp.waitForData(WaitingOperationStatus.SUBMITTED);
    await approvalOp.sendCallbackSuccess("approve");

    const result = await executionPromise;
    const finalState = result.getResult() as {
      messages: DemoMessage[];
      orderTotal: number | null;
    };

    // Appendix A trace: user -> lookup call -> lookup result -> refund call -> refund result -> final.
    const contents = finalState.messages.map((m) => m.content);
    expect(contents).toEqual([
      "Please refund order A-91.",
      "Let me look up that order.",
      "Order A-91 total 240.",
      "I'll issue the refund.",
      "Refunded $240 on A-91.",
      "Done — $240 refunded.",
    ]);
    expect(finalState.orderTotal).toBe(240);
  });

  it("routes to a denial when the approval is rejected", async () => {
    const handler = compileDurable(refundGraph);
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const approvalOp = runner.getOperation<string>("approval");
    const executionPromise = runner.run({ payload: { input: initialInput } });

    await approvalOp.waitForData(WaitingOperationStatus.SUBMITTED);
    await approvalOp.sendCallbackSuccess("deny");

    const result = await executionPromise;
    const finalState = result.getResult() as { messages: DemoMessage[] };
    const contents = finalState.messages.map((m) => m.content);
    // The fake model still concludes after the tool message; the tool message reflects denial.
    expect(contents).toContain("Refund denied for A-91.");
  });

  it("tags the graph root context with subType 'DurableGraph' (custom subType round-trip)", async () => {
    const handler = compileDurable(refundGraph);
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const approvalOp = runner.getOperation<string>("approval");
    const executionPromise = runner.run({ payload: { input: initialInput } });
    await approvalOp.waitForData(WaitingOperationStatus.SUBMITTED);
    await approvalOp.sendCallbackSuccess("approve");
    const result = await executionPromise;

    const ops = result.getOperations();
    const subTypes = ops
      .map((o) => o.getSubType() as unknown as string | undefined)
      .filter(Boolean);
    // The custom subType strings must survive the round trip to Operation.SubType.
    expect(subTypes).toContain("DurableGraph");
    expect(subTypes).toContain("GraphSuperstep");
  });

  it("composes: runGraph inside a larger handler with its own steps around it", async () => {
    const handler = withDurableExecution<{ input: unknown }, unknown>(
      async (event, context: DurableContext) => {
        const pre = await context.step("pre", async () => "validated");
        const graphState = await runGraph(context, refundGraph, event.input);
        const post = await context.step("post", async () => "fulfilled");
        return {
          pre,
          post,
          messageCount: (graphState as { messages: DemoMessage[] }).messages
            .length,
        };
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const approvalOp = runner.getOperation<string>("approval");
    const executionPromise = runner.run({ payload: { input: initialInput } });
    await approvalOp.waitForData(WaitingOperationStatus.SUBMITTED);
    await approvalOp.sendCallbackSuccess("approve");
    const result = await executionPromise;

    expect(result.getResult()).toEqual({
      pre: "validated",
      post: "fulfilled",
      messageCount: 6,
    });
  });
});
