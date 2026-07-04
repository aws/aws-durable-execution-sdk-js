import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { buildSystemPrompt } from "./schema";
import { runSandboxedJs } from "./sandbox";

// ─── Multi-turn agent loop (advanced mode, Bedrock, SQL destinations) ─────────
//
// Kept free of any `vscode`/UI imports (like verdict.ts) so the loop can be
// unit- and integration-tested directly. Query execution is supplied by the
// caller via the runQuery callback; this module only drives the Bedrock
// Converse conversation.

const RUN_QUERY_TOOL: Tool = {
  toolSpec: {
    name: "run_query",
    description:
      "Run a read-only query to explore the data or compute a candidate answer. Returns the columns, total row count, and a sample of rows. Use it to discover the shape of the data (e.g. which keys exist in input/output) before writing a query that references specific fields.",
    inputSchema: {
      json: {
        type: "object",
        properties: {
          query: { type: "string", description: "The read-only query to run." },
          purpose: {
            type: "string",
            description:
              "Brief note on what you're trying to learn or compute with this query (shown to the user).",
          },
          lookbackHours: {
            type: "number",
            description:
              "Log-based sources only: how many hours back to search (default 24). Ignored for table/SQL sources.",
          },
        },
        required: ["query"],
      },
    },
  },
};

const FINISH_TOOL: Tool = {
  toolSpec: {
    name: "finish",
    description:
      "Call once you have a query whose results answer the user's question.",
    inputSchema: {
      json: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The final query whose results answer the question.",
          },
          explanation: {
            type: "string",
            description: "One sentence explaining what the final query does.",
          },
          answer: {
            type: "string",
            description:
              "Optional plain-language answer derived from the rows, for questions the table alone doesn't answer.",
          },
          suggestedCharts: { type: "array", items: { type: "string" } },
          rowLevel: {
            type: "boolean",
            description:
              "True only if each result row is a single execution the user is browsing (enables per-row drill-down). False for aggregations/DISTINCT/derived results.",
          },
          lookbackHours: {
            type: "number",
            description:
              "Log-based sources only: the time window (hours back) the final query should run over (default 24). Ignored for table/SQL sources.",
          },
        },
        required: ["query", "explanation"],
      },
    },
  },
};

const RUN_JAVASCRIPT_TOOL: Tool = {
  toolSpec: {
    name: "run_javascript",
    description:
      "Transform or compute over the rows returned by your most recent run_query, using JavaScript, when it's awkward to express in the query language (reshaping, custom aggregation, deriving values). The code runs as a function body with `rows` (an array of row objects keyed by column name) and `columns` (array of names) in scope, and must `return` its result. It is sandboxed: no filesystem, network, or host access — pure computation over the provided rows only. Run a query first so there is data to operate on.",
    inputSchema: {
      json: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "JavaScript function body. Has `rows` and `columns` in scope; must return the result (a value or array/object).",
          },
          purpose: {
            type: "string",
            description:
              "Brief note on what this computes (shown to the user).",
          },
        },
        required: ["code"],
      },
    },
  },
};

/** Result of executing one of the agent's run_query calls. */
export interface AgentQueryResult {
  columns: string[];
  rows: string[][]; // a bounded sample, not necessarily all rows
  rowCount: number;
  error?: string;
  /** Set by the caller to force the loop to stop (e.g. cost budget reached). */
  stop?: boolean;
  stopReason?: string;
}

export type RunQueryFn = (
  query: string,
  lookbackHours?: number,
) => Promise<AgentQueryResult>;

/** A transcript event emitted as the agent works, for the webview. */
export interface AgentStepEvent {
  kind: "query" | "error" | "finish" | "note" | "script";
  query?: string;
  purpose?: string;
  rowCount?: number;
  detail?: string;
}

/** The agent's final decision: the query to present (plus optional prose answer). */
export interface AgentFinal {
  query: string;
  explanation: string;
  answer?: string;
  suggestedCharts?: string[];
  rowLevel?: boolean;
  /** Log-based sources only: the time window (hours) for the final query. */
  lookbackHours?: number;
}

/** A prior conversation turn (summarized), for multi-turn continuity. */
export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
}

interface AgentLoopOptions {
  region: string;
  credentials: AwsCredentialIdentityProvider;
  modelId: string;
  question: string;
  destinationType: string;
  tableName?: string;
  runQuery: RunQueryFn;
  onStep: (event: AgentStepEvent) => void;
  maxIterations: number;
  /**
   * Earlier turns in the same conversation (user questions + the assistant's
   * answers), seeded before the new question so the model has context. The
   * within-question tool calls are NOT included here — only the summarized
   * turns — which keeps context small and the message sequence valid.
   */
  priorTurns?: ConversationTurn[];
}

/**
 * Multi-turn ReAct-style agent loop: the model uses run_query to explore the
 * data and compute candidate answers (seeing real columns/rows each time),
 * then calls finish with the query whose results answer the question. This is
 * the "explore first, then answer" behavior a single-shot generate/verify loop
 * can't do — e.g. discovering which keys exist in input/output before grouping
 * by one. Bedrock-only (uses Converse multi-turn tool use).
 *
 * Returns the model's finish decision, or a best-effort fallback (the last
 * query that returned rows) if it stops before finishing, or undefined if it
 * never produced a usable query.
 */
export async function runAgentLoop(
  opts: AgentLoopOptions,
): Promise<AgentFinal | undefined> {
  const client = new BedrockRuntimeClient({
    region: opts.region,
    credentials: opts.credentials,
  });
  const system = buildSystemPrompt(opts.destinationType as never, {
    tableName: opts.tableName,
    toolMode: "agent",
  });
  const messages: Message[] = [
    ...(opts.priorTurns ?? []).map((t) => ({
      role: t.role,
      content: [{ text: t.text }],
    })),
    { role: "user", content: [{ text: opts.question }] },
  ];
  const tried = new Set<string>();
  let lastGoodQuery: string | undefined;
  // The most recent run_query result, so run_javascript can compute over it.
  let lastResult: { columns: string[]; rows: string[][] } | undefined;

  for (let i = 0; i < opts.maxIterations; i++) {
    const response = await client.send(
      new ConverseCommand({
        modelId: opts.modelId,
        system: [{ text: system }],
        messages,
        toolConfig: {
          tools: [RUN_QUERY_TOOL, RUN_JAVASCRIPT_TOOL, FINISH_TOOL],
        },
        inferenceConfig: { maxTokens: 1024, temperature: 0 },
      }),
    );
    const message = response.output?.message;
    if (!message) break;
    messages.push(message);

    const blocks: ContentBlock[] = message.content ?? [];
    const toolUse = blocks.find((b) => "toolUse" in b && b.toolUse)?.toolUse;

    if (!toolUse) {
      // No tool call — treat any prose as a final answer, else stop.
      const text = blocks
        .map((b) => ("text" in b && b.text ? b.text : ""))
        .join("")
        .trim();
      if (text) {
        return { query: lastGoodQuery ?? "", explanation: "", answer: text };
      }
      break;
    }

    if (toolUse.name === "finish") {
      const inp = (toolUse.input ?? {}) as {
        query?: string;
        explanation?: string;
        answer?: string;
        suggestedCharts?: string[];
        rowLevel?: boolean;
        lookbackHours?: number;
      };
      opts.onStep({
        kind: "finish",
        query: inp.query,
        detail: inp.explanation,
      });
      return {
        query: (inp.query ?? lastGoodQuery ?? "").trim(),
        explanation: (inp.explanation ?? "").trim(),
        answer:
          typeof inp.answer === "string" && inp.answer.trim()
            ? inp.answer.trim()
            : undefined,
        suggestedCharts: Array.isArray(inp.suggestedCharts)
          ? inp.suggestedCharts
          : undefined,
        rowLevel: inp.rowLevel === true,
        lookbackHours:
          typeof inp.lookbackHours === "number" && inp.lookbackHours > 0
            ? inp.lookbackHours
            : undefined,
      };
    }

    if (toolUse.name === "run_javascript") {
      const jinp = (toolUse.input ?? {}) as {
        code?: string;
        purpose?: string;
      };
      const code = (jinp.code ?? "").trim();
      const jsPurpose =
        typeof jinp.purpose === "string" ? jinp.purpose : undefined;
      let payload: unknown;
      if (!code) {
        payload = { error: "No code provided." };
      } else if (!lastResult) {
        payload = {
          error: "No data yet — run a query with run_query first.",
        };
      } else {
        const objectRows = lastResult.rows.map((r) => {
          const obj: Record<string, string> = {};
          lastResult!.columns.forEach((c, idx) => {
            obj[c] = r[idx] ?? "";
          });
          return obj;
        });
        const sandbox = await runSandboxedJs(code, {
          rows: objectRows,
          columns: lastResult.columns,
        });
        payload = sandbox.ok
          ? { result: sandbox.value }
          : { error: sandbox.error };
      }
      opts.onStep({
        kind: "script",
        query: code,
        purpose: jsPurpose,
        detail:
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error: unknown }).error)
            : jsPurpose,
      });
      messages.push({
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: toolUse.toolUseId,
              content: [{ text: JSON.stringify(payload) }],
            },
          },
        ],
      });
      continue;
    }

    // run_query
    const inp = (toolUse.input ?? {}) as {
      query?: string;
      purpose?: string;
      lookbackHours?: number;
    };
    const query = (inp.query ?? "").trim();
    const purpose = typeof inp.purpose === "string" ? inp.purpose : undefined;
    const lookbackHours =
      typeof inp.lookbackHours === "number" && inp.lookbackHours > 0
        ? inp.lookbackHours
        : undefined;
    const norm = query.replace(/\s+/g, " ").toLowerCase();

    let result: AgentQueryResult;
    if (!query) {
      result = {
        columns: [],
        rows: [],
        rowCount: 0,
        error: "Empty query. Provide a query, or call finish.",
      };
    } else if (tried.has(norm)) {
      result = {
        columns: [],
        rows: [],
        rowCount: 0,
        error:
          "You already ran this exact query and its result is above. Try a different query or call finish.",
      };
    } else {
      tried.add(norm);
      result = await opts.runQuery(query, lookbackHours);
      if (!result.error) {
        lastGoodQuery = query;
        lastResult = { columns: result.columns, rows: result.rows };
      }
    }

    opts.onStep({
      kind: result.error ? "error" : "query",
      query,
      purpose,
      rowCount: result.error ? undefined : result.rowCount,
      detail: result.error ?? purpose,
    });

    const payload = result.error
      ? { error: result.error }
      : {
          columns: result.columns,
          rowCount: result.rowCount,
          sampleRows: result.rows,
        };
    messages.push({
      role: "user",
      content: [
        {
          toolResult: {
            toolUseId: toolUse.toolUseId,
            content: [{ text: JSON.stringify(payload) }],
          },
        },
      ],
    });

    if (result.stop) {
      opts.onStep({
        kind: "note",
        detail: result.stopReason ?? "Stopped: budget reached.",
      });
      break;
    }
  }

  // Ran out of iterations / stopped without an explicit finish. Fall back to
  // the last query that returned data, so the user still sees something.
  if (lastGoodQuery) {
    return { query: lastGoodQuery, explanation: "" };
  }
  return undefined;
}
