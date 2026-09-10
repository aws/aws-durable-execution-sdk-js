/**
 * Hermetic local test for the Bedrock support-agent example.
 *
 * The model is STUBBED (an injectable {@link ModelFn}), so this test is free, deterministic, and
 * runs with no network — exactly the seam `buildSupportAgentGraph(model)` exists for. Real
 * Bedrock is exercised only in the cloud (see this example's README). Copied structurally from
 * `src/demo/__tests__/refund-agent.integration.test.ts`.
 *
 * What it proves:
 *   - the agent<->tools ReAct cycle runs and folds tool results back into history;
 *   - routing reads the CHECKPOINTED `decision` channel (never the model);
 *   - the human-in-the-loop approval gate suspends via waitForCallback and resumes with the
 *     human's decision, on BOTH the approve and deny paths;
 *   - the graph root context is tagged `DurableGraph` (custom subType round-trip);
 *   - the graph composes inside a larger durable handler;
 *   - the MAX_TICKS guard forces END when a model loops.
 */

import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { runGraph } from "../../../src/runtime/run-graph";
import { compileDurable } from "../../../src/runtime/compile-durable";
import {
  type AgentMessage,
  type Decision,
  type ModelFn,
  MAX_TICKS,
  buildSupportAgentGraph,
  deriveDecision,
} from "../graph";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

/** Read the last message. */
function last(messages: readonly AgentMessage[]): AgentMessage | undefined {
  return messages[messages.length - 1];
}

/**
 * Deterministic STUB model — a pure function of message history, no I/O/clock/RNG. It walks the
 * refund script exactly like the fake model in the demo, but through the real graph's tool-use
 * shape (`toolUseId` + `toolCalls`) so the wiring under test is the real one:
 *
 *   1. initial user request                  -> lookup_order(A-91)
 *   2. lookup_order result                   -> issue_refund(A-91, 240)   (> $100 -> approval)
 *   3. issue_refund tool result (from human) -> final answer (no tools -> "done")
 */
const scriptedModel: ModelFn = async ({ messages }) => {
  const m = last(messages);

  // Step 2: order looked up -> request the (large) refund.
  if (m?.role === "tool" && m.content.startsWith("Order A-91")) {
    return {
      role: "assistant",
      content: "I'll issue the refund.",
      toolCalls: [
        {
          toolUseId: "refund-1",
          name: "issue_refund",
          input: { orderId: "A-91", amount: 240 },
        },
      ],
    };
  }

  // Step 3: any refund tool result (approved or denied) -> final answer, no tool calls.
  if (m?.role === "tool") {
    return {
      role: "assistant",
      content: m.content.startsWith("Refund of")
        ? "Done — your refund has been processed."
        : "I'm sorry, the refund was not approved.",
    };
  }

  // Step 1 (default): initial user request -> look up the order.
  return {
    role: "assistant",
    content: "Let me look up that order.",
    toolCalls: [
      {
        toolUseId: "lookup-1",
        name: "lookup_order",
        input: { orderId: "A-91" },
      },
    ],
  };
};

const initialInput = {
  messages: {
    role: "user",
    content: "Please refund order A-91.",
  } as AgentMessage,
};

describe("bedrock support-agent example (stubbed model)", () => {
  it("runs the ReAct loop through an APPROVED interrupt to a final answer", async () => {
    const graph = buildSupportAgentGraph(scriptedModel);
    const handler = compileDurable(graph);
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    // Register interest in the approval callback BEFORE run() (canonical pattern).
    const approvalOp = runner.getOperation<string>("approval");
    const executionPromise = runner.run({ payload: { input: initialInput } });

    // Suspends at the refund approval (amount 240 > $100). Complete it with "approve".
    await approvalOp.waitForData(WaitingOperationStatus.SUBMITTED);
    await approvalOp.sendCallbackSuccess("approve");

    const result = await executionPromise;
    const finalState = result.getResult() as {
      messages: AgentMessage[];
      decision: Decision | null;
      approval: "approve" | "deny" | null;
    };

    const contents = finalState.messages.map((m) => m.content);
    expect(contents).toEqual([
      "Please refund order A-91.",
      "Let me look up that order.",
      "Order A-91: total $240, placed 2026-08-15, status delivered.",
      "I'll issue the refund.",
      "Refund of $240 issued for order A-91.",
      "Done — your refund has been processed.",
    ]);
    // The human decision was recorded, and the final routing decision was "done".
    expect(finalState.approval).toBe("approve");
    expect(finalState.decision).toBe("done");
  });

  it("routes to a DENIAL when the approval is rejected", async () => {
    const graph = buildSupportAgentGraph(scriptedModel);
    const handler = compileDurable(graph);
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const approvalOp = runner.getOperation<string>("approval");
    const executionPromise = runner.run({ payload: { input: initialInput } });

    await approvalOp.waitForData(WaitingOperationStatus.SUBMITTED);
    await approvalOp.sendCallbackSuccess("deny");

    const result = await executionPromise;
    const finalState = result.getResult() as {
      messages: AgentMessage[];
      approval: "approve" | "deny" | null;
    };
    const contents = finalState.messages.map((m) => m.content);
    expect(contents).toContain(
      "Refund of $240 for order A-91 was DENIED by a human reviewer.",
    );
    expect(finalState.approval).toBe("deny");
  });

  it("tags the graph root context with subType 'DurableGraph'", async () => {
    const graph = buildSupportAgentGraph(scriptedModel);
    const handler = compileDurable(graph);
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const approvalOp = runner.getOperation<string>("approval");
    const executionPromise = runner.run({ payload: { input: initialInput } });
    await approvalOp.waitForData(WaitingOperationStatus.SUBMITTED);
    await approvalOp.sendCallbackSuccess("approve");
    const result = await executionPromise;

    const subTypes = result
      .getOperations()
      .map((o) => o.getSubType() as unknown as string | undefined)
      .filter(Boolean);
    expect(subTypes).toContain("DurableGraph");
    expect(subTypes).toContain("GraphSuperstep");
  });

  it("composes: runGraph inside a larger handler with steps around it", async () => {
    const graph = buildSupportAgentGraph(scriptedModel);
    const handler = withDurableExecution<{ input: unknown }, unknown>(
      async (event, context: DurableContext) => {
        const pre = await context.step("pre", async () => "validated");
        const graphState = await runGraph(context, graph, event.input);
        const post = await context.step("post", async () => "fulfilled");
        return {
          pre,
          post,
          messageCount: (graphState as { messages: AgentMessage[] }).messages
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

  it("enforces MAX_TICKS: a looping model is forced to END", async () => {
    // A pathological model that ALWAYS asks for a small (no-approval) tool call and never
    // finishes. Without the cap this would loop forever; the router must force END at the cap.
    const loopingModel: ModelFn = async () => ({
      role: "assistant",
      content: "looking again...",
      toolCalls: [
        {
          toolUseId: "loop",
          name: "lookup_order",
          input: { orderId: "A-91" },
        },
      ],
    });

    const graph = buildSupportAgentGraph(loopingModel);
    const handler = compileDurable(graph);
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    // No approval is ever requested (small tool), so the execution runs to completion.
    const result = await runner.run({ payload: { input: initialInput } });
    const finalState = result.getResult() as { turns: number };

    // The agent ran exactly up to the cap, then the router sent it to END.
    expect(finalState.turns).toBe(MAX_TICKS);
  });

  it("deriveDecision is pure and threshold-aware", () => {
    expect(deriveDecision({ role: "assistant", content: "done" })).toBe("done");
    expect(
      deriveDecision({
        role: "assistant",
        content: "",
        toolCalls: [
          { toolUseId: "t", name: "lookup_order", input: { orderId: "A-91" } },
        ],
      }),
    ).toBe("use_tools");
    expect(
      deriveDecision({
        role: "assistant",
        content: "",
        toolCalls: [
          {
            toolUseId: "t",
            name: "issue_refund",
            input: { orderId: "A-91", amount: 240 },
          },
        ],
      }),
    ).toBe("need_approval");
    // At/under the threshold does NOT need approval.
    expect(
      deriveDecision({
        role: "assistant",
        content: "",
        toolCalls: [
          {
            toolUseId: "t",
            name: "issue_refund",
            input: { orderId: "B-12", amount: 100 },
          },
        ],
      }),
    ).toBe("use_tools");
  });
});
