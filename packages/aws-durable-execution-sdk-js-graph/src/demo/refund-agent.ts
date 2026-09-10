/**
 * Hermetic demo: the refund-approval agent from design doc Appendix A.
 *
 * Topology: `START -> agent`, `agent -(conditional)-> tools | END`, `tools -> agent`.
 * That is a two-node cycle (`agent` <-> `tools`) with one conditional edge and one interrupt,
 * which produces the Appendix A superstep trace:
 *
 *   t0 agent  → tool_call: lookup_order(A-91)
 *   t1 tools  → ToolMessage(order total 240)
 *   t2 agent  → tool_call: issue_refund(A-91, 240)
 *   t3 tools  → interrupt (approval) → ToolMessage("Refunded $240")
 *   t4 agent  → "Done — $240 refunded." → END
 *
 * The "model" is FAKE and deterministic — a pure function of the message history. There are NO
 * network calls, so the demo runs hermetically under LocalDurableTestRunner. The model's
 * decision is written into the state delta, so the conditional edge routes on a *checkpointed*
 * value (design doc §4.4 rule), never on a live call.
 */

import { type GraphDef, StateGraph } from "../builder";
import { END, START, StateSchema, appendValue, lastValue } from "../schema";
import { interrupt } from "../interrupt";

/**
 * A minimal chat message. `toolCalls` present ⇒ the agent wants tools to run next; absent ⇒ the
 * agent produced a final answer and the graph should route to END.
 */
export interface DemoMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  /** Present on assistant messages that request tool execution. */
  toolCalls?: DemoToolCall[];
}

export interface DemoToolCall {
  name: "lookup_order" | "issue_refund";
  args: Record<string, string | number>;
}

/**
 * The demo's channels:
 *   - `messages`: append-only chat history (the agent loop reads/writes it).
 *   - `orderTotal`: last-write-wins, set by the `lookup_order` tool; the model reads it to
 *     decide the refund amount. Demonstrates a non-message channel.
 */
export const demoSchema = new StateSchema({
  messages: appendValue<DemoMessage>(),
  orderTotal: lastValue<number | null>(null),
});

/** Convenience: read the last message in history. */
function lastMessage(messages: DemoMessage[]): DemoMessage | undefined {
  return messages[messages.length - 1];
}

/**
 * FAKE deterministic model. Pure function of history — no I/O, no clock, no RNG. It walks the
 * Appendix A script:
 *   1. If the last message is the initial user request → ask to look up the order.
 *   2. If the last message is the lookup ToolMessage → ask to issue the refund.
 *   3. If the last message is the refund ToolMessage → produce the final answer (no toolCalls).
 */
function fakeModel(messages: DemoMessage[]): DemoMessage {
  const last = lastMessage(messages);

  // Step 2: order looked up → request the refund. (The lookup tool result starts with "Order".)
  if (last?.role === "tool" && last.content.startsWith("Order")) {
    return {
      role: "assistant",
      content: "I'll issue the refund.",
      toolCalls: [
        { name: "issue_refund", args: { orderId: "A-91", amount: 240 } },
      ],
    };
  }

  // Step 3: any other tool result (refund confirmed OR denied) → final answer, no tool calls.
  // Routing on the ABSENCE of tool calls sends the graph to END.
  if (last?.role === "tool") {
    return last.content.startsWith("Refunded")
      ? { role: "assistant", content: "Done — $240 refunded." }
      : { role: "assistant", content: "Understood — no refund was issued." };
  }

  // Step 1 (default): initial user request → look up the order.
  return {
    role: "assistant",
    content: "Let me look up that order.",
    toolCalls: [{ name: "lookup_order", args: { orderId: "A-91" } }],
  };
}

/**
 * Build the demo graph. Constructed here (module-scope style) so topology never depends on the
 * event payload (brief invariant 5). Returns the compiled {@link GraphDef}.
 */
export function buildRefundGraph(): GraphDef<typeof demoSchema.channels> {
  const graph = new StateGraph(demoSchema, "refund-approval");

  // The agent node: run the fake model in a durable step, append its message, and stash the
  // refund amount decision is already in state via the tool. The model call is wrapped in
  // `ctx.step` so that, were it a real model, it would be checkpointed with its own retry.
  graph.addNode("agent", async (state, { ctx }) => {
    const reply = await ctx.step("invoke-model", async () =>
      fakeModel(state.messages),
    );
    return { messages: reply };
  });

  // The tools node: execute the tool the agent requested. `issue_refund` interrupts for human
  // approval via waitForCallback before completing (design doc §4.6, Appendix A t3).
  graph.addNode("tools", async (state, nodeCtx) => {
    const { ctx } = nodeCtx;
    const last = lastMessage(state.messages);
    const call = last?.toolCalls?.[0];
    if (!call) {
      // Defensive: routing guarantees we only reach `tools` when a tool call exists.
      return {};
    }

    if (call.name === "lookup_order") {
      const total = await ctx.step("lookup-order", async () => 240);
      return {
        orderTotal: total,
        messages: {
          role: "tool",
          content: `Order ${String(call.args.orderId)} total ${total}.`,
        } as DemoMessage,
      };
    }

    // issue_refund → pause for human approval. The invocation ends here on first run; an
    // external system resumes it by completing the callback with the decision.
    const decision = await interrupt<string>(
      nodeCtx,
      "approval",
      async (_callbackId) => {
        // In production: notify the reviewer with the callback id. Hermetic here — the test
        // harness completes the callback directly.
      },
    );
    const amount = state.orderTotal ?? 0;
    return {
      messages: {
        role: "tool",
        content:
          decision === "approve"
            ? `Refunded $${amount} on ${String(call.args.orderId)}.`
            : `Refund denied for ${String(call.args.orderId)}.`,
      } as DemoMessage,
    };
  });

  // Wiring.
  graph.addEdge(START, "agent");
  graph.addEdge("tools", "agent");
  // Conditional edge: route to tools when the agent requested a tool, else END. PURE — reads
  // only the checkpointed message the agent wrote.
  graph.addConditionalEdges(
    "agent",
    (state) => {
      const last = lastMessage(state.messages);
      return last?.toolCalls && last.toolCalls.length > 0 ? "tools" : END;
    },
    ["tools", END],
  );

  return graph.compile();
}

/** The compiled demo graph, ready to hand to {@link runGraph} or {@link compileDurable}. */
export const refundGraph = buildRefundGraph();
