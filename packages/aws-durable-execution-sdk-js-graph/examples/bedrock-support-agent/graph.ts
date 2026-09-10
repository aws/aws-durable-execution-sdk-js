/**
 * Bedrock-backed customer-support refund agent — the REAL-model sibling of the hermetic
 * `src/demo/refund-agent.ts`.
 *
 * This is the canonical ReAct-plus-approval shape, driven by Amazon Bedrock (Claude Sonnet 4.5
 * via the Converse API) running on the Durable Graph POC runtime:
 *
 *   START -> agent
 *   agent --(conditional on a CHECKPOINTED decision)--> tools | approval | END
 *   tools -> agent          # the ReAct cycle
 *   approval -> agent       # human-in-the-loop; resumes the loop
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * THE CRITICAL CORRECTNESS POINT (read before touching this file)
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * An LLM is NON-DETERMINISTIC. The durable runtime replays the handler from the top on every
 * resume/crash. So the whole example rests on three rules, each enforced below and flagged at
 * its call site:
 *
 *   1. EVERY Bedrock call is inside `ctx.step(...)`. On replay the *recorded* response is
 *      returned instead of re-invoking the model. A call outside a step would return a
 *      DIFFERENT answer on replay, the graph would route differently, and the execution would
 *      corrupt. This is the single most important thing the example teaches.
 *
 *   2. ROUTING reads ONLY a checkpointed `decision` field that the agent node wrote into the
 *      state delta. The router NEVER calls the model. (design doc §4.4/§5.5 rule 3.)
 *
 *   3. REDUCERS and ROUTERS are pure: no `Date.now`, no `Math.random`, no I/O. Tools are
 *      deterministic canned data, so the model is the ONLY source of non-determinism in the
 *      whole graph — which is exactly what makes rule 1 sufficient for replay safety.
 *
 * A max-tick cap guards against a confused model looping forever.
 *
 * The model is injected as a callable (see {@link ModelFn} / {@link buildSupportAgentGraph}),
 * so the local test can swap in a deterministic stub while the cloud deployment passes the real
 * Bedrock-backed implementation from `./model`. That injection is both what makes the test
 * hermetic/free and simply better structure.
 */

import { type GraphDef, StateGraph } from "../../src/builder";
import {
  END,
  START,
  StateSchema,
  appendValue,
  lastValue,
} from "../../src/schema";
import { interrupt } from "../../src/interrupt";

// ───────────────────────────────────────────────────────────────────────────────────────────
// Message + tool shapes (a minimal, plain-JSON mirror of the Bedrock Converse message model).
// We keep our own tiny shape rather than importing Bedrock's, so `graph.ts` stays free of the
// AWS SDK — the SDK types live only in `model.ts`, at the boundary. Plain JSON also serialises
// cleanly through the durable checkpoint store (brief scope: no class serdes).
// ───────────────────────────────────────────────────────────────────────────────────────────

/** The names of the tools we expose to the model. */
export type ToolName = "lookup_order" | "lookup_policy" | "issue_refund";

/** A single tool-use request the model emitted (Converse `content[].toolUse`). */
export interface ToolCall {
  /** Bedrock's `toolUseId`; echoed back verbatim in the tool result so the model can pair them. */
  toolUseId: string;
  name: ToolName;
  input: Record<string, unknown>;
}

/**
 * A chat message. `role: "tool"` carries a tool RESULT back to the model; on assistant messages
 * `toolCalls` (when present) are the tool-use blocks the model requested this turn.
 */
export interface AgentMessage {
  role: "user" | "assistant" | "tool";
  /** Human-readable text. For tool results this is the text we hand back to the model. */
  content: string;
  /** Present on assistant messages that requested tool execution. */
  toolCalls?: ToolCall[];
  /** Present on tool-result messages: which tool-use id this result answers. */
  toolUseId?: string;
}

/**
 * The decision the agent node derived from the model response and wrote into state. The router
 * reads ONLY this — never the model. See rule 2 above.
 *
 *   - `use_tools`     — the model requested tool(s); run the `tools` node.
 *   - `need_approval` — the model wants `issue_refund` above the threshold; run `approval`.
 *   - `done`          — the model produced a final answer (no tool use); route to END.
 */
export type Decision = "use_tools" | "need_approval" | "done";

/**
 * The shape the injected model returns. It is a PURE-INTERFACE result: given the running message
 * history and the tool specs, produce the assistant's next message. All non-determinism (and, in
 * the real implementation, all network I/O) lives behind this callable, and the agent node only
 * ever invokes it inside `ctx.step`.
 */
export type ModelFn = (input: {
  messages: AgentMessage[];
}) => Promise<AgentMessage>;

// ───────────────────────────────────────────────────────────────────────────────────────────
// Config
// ───────────────────────────────────────────────────────────────────────────────────────────

/** Refunds strictly above this dollar amount require human approval. */
export const APPROVAL_THRESHOLD = 100;

/**
 * Hard cap on superstep ticks. The agent<->tools cycle is unbounded in principle (the model
 * decides when to stop), so a confused or adversarial model could loop forever and burn money.
 * When the cap is hit, the router forces END. Pure: it reads a checkpointed counter.
 */
export const MAX_TICKS = 12;

// ───────────────────────────────────────────────────────────────────────────────────────────
// State schema (channels + reducers). Reducers MUST be pure — they run OUTSIDE steps and
// re-execute on every replay (design doc §4.5, brief invariant 3).
// ───────────────────────────────────────────────────────────────────────────────────────────

export const supportAgentSchema = new StateSchema({
  /** Append-only chat history; the agent loop reads and writes it. */
  messages: appendValue<AgentMessage>(),

  /**
   * The checkpointed routing decision the agent node derived from the model response. The
   * conditional edge reads ONLY this (rule 2). `null` before the first agent turn.
   */
  decision: lastValue<Decision | null>(null),

  /**
   * Number of agent turns taken. Incremented by the agent node; read by the router to enforce
   * {@link MAX_TICKS}. Last-write-wins with an explicit new value (the node computes count+1),
   * so folding stays pure.
   */
  turns: lastValue<number>(0),

  /**
   * The human's decision delivered by the approval callback (`"approve" | "deny"`), or `null`
   * when no approval is pending/complete. Written by the `approval` node.
   */
  approval: lastValue<"approve" | "deny" | null>(null),
});

export type SupportChannels = typeof supportAgentSchema.channels;

// ───────────────────────────────────────────────────────────────────────────────────────────
// Deterministic tools (canned data, no network). Because these are deterministic, the MODEL is
// the only source of non-determinism in the graph — which is what makes "every model call in a
// step" a sufficient condition for replay safety.
// ───────────────────────────────────────────────────────────────────────────────────────────

/** A tiny canned order book. Real code would hit a service; the POC keeps tools hermetic. */
const CANNED_ORDERS: Record<
  string,
  { total: number; date: string; status: string }
> = {
  "A-91": { total: 240, date: "2026-08-15", status: "delivered" },
  "B-12": { total: 45, date: "2026-09-01", status: "delivered" },
};

/** Canned refund-policy text keyed by topic. */
const CANNED_POLICY: Record<string, string> = {
  refund:
    "Orders may be refunded within 30 days of delivery. Refunds over $100 require " +
    "a supervisor's approval.",
  default: "Standard 30-day return policy applies.",
};

/**
 * Execute one tool call and return the text to hand back to the model. Pure and deterministic;
 * `issue_refund` NEVER decides approval itself — the graph's `approval` node owns that gate, so
 * this function only reports the mechanical outcome given an already-authorised amount.
 */
function runTool(call: ToolCall): string {
  switch (call.name) {
    case "lookup_order": {
      const id = String(call.input.orderId ?? "");
      const order = CANNED_ORDERS[id];
      return order
        ? `Order ${id}: total $${order.total}, placed ${order.date}, status ${order.status}.`
        : `Order ${id} not found.`;
    }
    case "lookup_policy": {
      const topic = String(call.input.topic ?? "default");
      return CANNED_POLICY[topic] ?? CANNED_POLICY.default;
    }
    case "issue_refund": {
      const id = String(call.input.orderId ?? "");
      const amount = Number(call.input.amount ?? 0);
      return `Refund of $${amount} issued for order ${id}.`;
    }
    default: {
      // Exhaustiveness guard: a new ToolName must be handled here.
      const never: never = call.name;
      return `Unknown tool: ${String(never)}`;
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ───────────────────────────────────────────────────────────────────────────────────────────

/** Read the last message. Pure. */
function lastMessage(
  messages: readonly AgentMessage[],
): AgentMessage | undefined {
  return messages[messages.length - 1];
}

/**
 * Derive the checkpointed {@link Decision} from an assistant message. PURE — a function of the
 * already-produced message, not of the model. This is what the agent node writes into state so
 * the router can read a checkpointed value.
 *
 *   - no tool calls                              -> "done"
 *   - an `issue_refund` above the threshold      -> "need_approval"
 *   - any other tool call(s)                     -> "use_tools"
 */
export function deriveDecision(reply: AgentMessage): Decision {
  const calls = reply.toolCalls ?? [];
  if (calls.length === 0) {
    return "done";
  }
  const refund = calls.find((c) => c.name === "issue_refund");
  if (refund && Number(refund.input.amount ?? 0) > APPROVAL_THRESHOLD) {
    return "need_approval";
  }
  return "use_tools";
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Graph builder
// ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Build the support-agent graph around an injected {@link ModelFn}.
 *
 * Constructed at call time from a pure `model` argument (no event data influences topology —
 * brief invariant 5). The cloud entry passes the real Bedrock model; the local test passes a
 * deterministic stub.
 *
 * @param model - The model callable. MUST be invoked only inside `ctx.step` (the node below does
 *   this). Injecting it is what lets the test run hermetically and for free.
 */
export function buildSupportAgentGraph(
  model: ModelFn,
): GraphDef<SupportChannels> {
  const graph = new StateGraph(supportAgentSchema, "bedrock-support-agent");

  // ── agent node ────────────────────────────────────────────────────────────────────────────
  // One Bedrock Converse call, INSIDE ctx.step. Writes the assistant message, the derived
  // decision, and the incremented turn counter into the state delta.
  graph.addNode("agent", async (state, { ctx }) => {
    // RULE 1 (the whole point): the model call is wrapped in ctx.step("invoke-model", ...).
    // The model is non-deterministic; on replay the recorded response is returned instead of
    // re-invoking Bedrock. A call OUTSIDE this step would yield a different answer on replay,
    // the router would branch differently, and the execution would corrupt. Each model call is
    // therefore its OWN checkpoint with its OWN retry policy — crash mid-loop and we never
    // re-pay for model turns already recorded (design doc §4.4).
    const reply = await ctx.step(
      "invoke-model",
      async () => model({ messages: [...state.messages] }),
      {
        // Bedrock throttling / transient 5xx are retryable; a malformed-request 4xx is not.
        // Pure decision function of (error, attempt) — no clock, no RNG.
        retryStrategy: (error: Error, attempt: number) => {
          const retryable =
            /throttl|timeout|throttlingexception|serviceunavailable|5\d\d/i.test(
              `${error.name} ${error.message}`,
            );
          return retryable && attempt < 5
            ? { shouldRetry: true, delay: { seconds: 2 } }
            : { shouldRetry: false };
        },
      },
    );

    // RULE 2: derive the routing decision HERE (pure) and write it into the delta, so the
    // conditional edge reads a checkpointed value and never touches the model.
    const decision = deriveDecision(reply);

    return {
      messages: reply,
      decision,
      turns: state.turns + 1,
    };
  });

  // ── tools node ────────────────────────────────────────────────────────────────────────────
  // Execute the tool(s) the agent requested. Each execution is its OWN ctx.step, so a crash
  // between two tools does not re-run the first (design doc §4.4). Tools are deterministic, so
  // these steps are trivially replay-safe.
  graph.addNode("tools", async (state, { ctx }) => {
    const last = lastMessage(state.messages);
    const calls = last?.toolCalls ?? [];
    if (calls.length === 0) {
      // Defensive: routing only sends us here when the decision was "use_tools".
      return {};
    }

    const results: AgentMessage[] = [];
    for (const call of calls) {
      // Deterministic canned data. Wrapped in a step anyway so each tool result is individually
      // checkpointed and attributed (its name encodes the tool-use id for a stable structural
      // path — no clock/RNG in the name).
      const text = await ctx.step(`tool-${call.toolUseId}`, async () =>
        runTool(call),
      );
      results.push({ role: "tool", content: text, toolUseId: call.toolUseId });
    }
    return { messages: results };
  });

  // ── approval node (human-in-the-loop) ───────────────────────────────────────────────────────
  // Reached only when the decision is "need_approval". Suspends via waitForCallback: the Lambda
  // invocation ENDS, nothing is billed while waiting (up to a year), and an external reviewer
  // resumes it with "approve"/"deny". The resumed value goes into state, and a tool-result
  // message reflecting the human decision is appended so the agent loop can continue.
  graph.addNode("approval", async (state, nodeCtx) => {
    const last = lastMessage(state.messages);
    const refundCall = (last?.toolCalls ?? []).find(
      (c) => c.name === "issue_refund",
    );

    // Suspend for human approval. `"approval"` is a stable local label (part of the structural
    // path — no state/clock/RNG, brief invariant 4). The submitter is where production code
    // notifies the reviewer with the callback id; hermetic here.
    const decision = await interrupt<"approve" | "deny">(
      nodeCtx,
      "approval",
      async (_callbackId) => {
        // Production: send the reviewer a link carrying `_callbackId`. No secrets in logs.
      },
    );

    // Turn the human decision into a tool result the model will read on the next agent turn.
    const orderId = String(refundCall?.input.orderId ?? "unknown");
    const amount = Number(refundCall?.input.amount ?? 0);
    const toolUseId = refundCall?.toolUseId ?? "approval";
    const text =
      decision === "approve"
        ? runTool({
            toolUseId,
            name: "issue_refund",
            input: { orderId, amount },
          })
        : `Refund of $${amount} for order ${orderId} was DENIED by a human reviewer.`;

    return {
      approval: decision,
      messages: { role: "tool", content: text, toolUseId } as AgentMessage,
    };
  });

  // ── wiring ──────────────────────────────────────────────────────────────────────────────────
  graph.addEdge(START, "agent");
  graph.addEdge("tools", "agent"); // ReAct cycle
  graph.addEdge("approval", "agent"); // resume the loop after a human decision

  // Conditional edge out of `agent`. PURE — reads ONLY the checkpointed `decision` and `turns`
  // channels the agent node wrote. Never calls the model (rule 2). Enforces MAX_TICKS (rule:
  // a confused model cannot loop forever).
  graph.addConditionalEdges(
    "agent",
    (state) => {
      if (state.turns >= MAX_TICKS) {
        return END; // runaway-loop guard
      }
      switch (state.decision) {
        case "use_tools":
          return "tools";
        case "need_approval":
          return "approval";
        default:
          return END; // "done" or null
      }
    },
    ["tools", "approval", END],
  );

  return graph.compile();
}
