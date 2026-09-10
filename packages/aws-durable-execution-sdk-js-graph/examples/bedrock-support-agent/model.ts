/**
 * The REAL Bedrock-backed {@link ModelFn}, built on the Converse API. This is the ONE file that
 * touches the AWS SDK and the raw Converse wire shapes — `graph.ts` stays SDK-free and takes this
 * as an injected callable. The local test injects a stub instead, so the graph wiring is proven
 * hermetically and this file only ever runs in the cloud.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * Determinism note (why this is safe despite being non-deterministic):
 *   This function IS the non-determinism in the graph. It is invoked ONLY from inside
 *   `ctx.step("invoke-model", ...)` in the agent node, so the runtime records its output on the
 *   first run and REPLAYS the recorded value afterwards — it is never called twice for the same
 *   turn. Never call it outside a step. See `graph.ts` rule 1.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Verified environment facts:
 *   - Region: us-east-1.
 *   - Model id (an inference profile, use verbatim):
 *       us.anthropic.claude-sonnet-4-5-20250929-v1:0
 *   - Converse returns stopReason "tool_use" with content[].toolUse = { toolUseId, name, input }.
 *   - Tool results go back as a user message with content[].toolResult =
 *       { toolUseId, content:[{ text | json }] }.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type Tool,
  type ToolConfiguration,
  type ToolUseBlock,
} from "@aws-sdk/client-bedrock-runtime";
import type { AgentMessage, ModelFn, ToolCall, ToolName } from "./graph";

/** Region for both Lambda and Bedrock (brief: durable functions + models proven here). */
export const BEDROCK_REGION = "us-east-1";

/** The exact inference-profile id verified working via Converse in us-east-1. */
export const MODEL_ID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

/**
 * The system prompt. Deterministic string — steers the model toward the refund workflow. Kept
 * here rather than in `graph.ts` so all Bedrock-specific detail stays at this boundary.
 */
const SYSTEM_PROMPT =
  "You are a customer-support refund agent. Use the provided tools to look up orders and " +
  "refund policy, then issue refunds when warranted. Always look up the order before issuing " +
  "a refund. When you have resolved the customer's request, reply with a short final message " +
  "and DO NOT call any tool.";

/**
 * The tool specs advertised to the model. This is the Converse `toolConfig.tools` shape; the
 * `name` strings MUST match {@link ToolName} in `graph.ts` so the agent can dispatch them.
 */
const TOOLS: Tool[] = [
  {
    toolSpec: {
      name: "lookup_order",
      description: "Look up an order's total, date, and status by order id.",
      inputSchema: {
        json: {
          type: "object",
          properties: { orderId: { type: "string" } },
          required: ["orderId"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "lookup_policy",
      description: "Look up refund-policy text for a topic (e.g. 'refund').",
      inputSchema: {
        json: {
          type: "object",
          properties: { topic: { type: "string" } },
          required: ["topic"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "issue_refund",
      description:
        "Issue a refund for an order. Refunds over $100 require human approval, " +
        "which the system enforces automatically.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            orderId: { type: "string" },
            amount: { type: "number" },
          },
          required: ["orderId", "amount"],
        },
      },
    },
  },
];

const TOOL_CONFIG: ToolConfiguration = { tools: TOOLS };

/** Tool names we understand, for narrowing the model's free-form tool name. */
const KNOWN_TOOLS: ReadonlySet<string> = new Set<ToolName>([
  "lookup_order",
  "lookup_policy",
  "issue_refund",
]);

/**
 * Convert our plain-JSON {@link AgentMessage} history into the Converse `Message[]` wire shape.
 * Pure. Tool-result messages become a `user` message carrying a `toolResult` block (per the
 * verified Converse contract); everything else maps role-for-role with a single text block.
 */
function toConverseMessages(messages: readonly AgentMessage[]): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: m.toolUseId ?? "unknown",
              content: [{ text: m.content }],
            },
          },
        ],
      });
      continue;
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      // Reconstruct the assistant turn as text + toolUse blocks so the model sees a coherent
      // history on multi-turn calls.
      const content: ContentBlock[] = [];
      if (m.content) {
        content.push({ text: m.content });
      }
      for (const call of m.toolCalls) {
        content.push({
          toolUse: {
            toolUseId: call.toolUseId,
            name: call.name,
            // `input` on the wire is a JSON value (the SDK's DocumentType). Our tool inputs are
            // plain JSON records; cast to the SDK's own field type without naming DocumentType
            // (which this package does not re-export). Boundary shim, not a runtime-shape lie.
            input: call.input as ToolUseBlock["input"],
          },
        });
      }
      out.push({ role: "assistant", content });
      continue;
    }
    out.push({ role: m.role, content: [{ text: m.content }] });
  }
  return out;
}

/**
 * Parse a Converse response into our {@link AgentMessage}. Pure. Collects any `toolUse` blocks
 * into {@link ToolCall}s and the text into `content`. Unknown tool names are dropped (defensive:
 * the model can only be handed the three specs above).
 */
function fromConverseOutput(content: ContentBlock[] | undefined): AgentMessage {
  const blocks = content ?? [];
  const texts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const block of blocks) {
    if (block.text) {
      texts.push(block.text);
    }
    const use = block.toolUse;
    if (use?.name && KNOWN_TOOLS.has(use.name)) {
      toolCalls.push({
        toolUseId: use.toolUseId ?? "unknown",
        name: use.name as ToolName,
        input: (use.input as Record<string, unknown>) ?? {},
      });
    }
  }
  const reply: AgentMessage = {
    role: "assistant",
    content: texts.join("\n").trim(),
  };
  if (toolCalls.length > 0) {
    reply.toolCalls = toolCalls;
  }
  return reply;
}

/**
 * Build the real Bedrock-backed {@link ModelFn}. The returned callable makes ONE `ConverseCommand`
 * per invocation. It performs network I/O and is non-deterministic, so — to say it once more — it
 * is only ever called from inside `ctx.step` in the agent node.
 *
 * @param client - Optional injected client (for advanced callers/tests). Defaults to a client in
 *   {@link BEDROCK_REGION}. The AWS SDK is bundled into the deployment artifact.
 */
export function createBedrockModel(client?: BedrockRuntimeClient): ModelFn {
  const bedrock =
    client ?? new BedrockRuntimeClient({ region: BEDROCK_REGION });

  return async ({ messages }) => {
    const response = await bedrock.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: SYSTEM_PROMPT }],
        messages: toConverseMessages(messages),
        inferenceConfig: { maxTokens: 512 },
        toolConfig: TOOL_CONFIG,
      }),
    );
    return fromConverseOutput(response.output?.message?.content);
  };
}
