import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type Tool,
  type ToolUseBlock,
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

// Max serialized size of a run_javascript return value. The result is
// JSON-stringified into the toolResult sent back to the model, so a large
// value would inflate tokens/cost — reject anything bigger and ask for a
// summary. ~20k chars ≈ a few thousand tokens.
const JS_RESULT_MAX_CHARS = 20_000;

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
      "Call to deliver your reply to the user. The reply is the natural-language `answer`; a `query` is optional supporting data.",
    inputSchema: {
      json: {
        type: "object",
        properties: {
          answer: {
            type: "string",
            description:
              "REQUIRED. A concise natural-language reply to the user. If you also return a `query`, its result rows are shown to the user in a TABLE below your reply — do NOT restate or list those rows; summarize them (how many, notable ranges/patterns) or give the specific insight asked for. One or two sentences is plenty for a 'show/list records' request. Only when there is NO supporting table (conceptual/metadata questions, e.g. 'which field holds the amount?') should the answer spell out the fields/values itself.",
          },
          query: {
            type: "string",
            description:
              "Optional. A query whose result table supports the answer. Omit it for questions that are fully answered by `answer` alone (e.g. 'which field holds the amount?').",
          },
          explanation: {
            type: "string",
            description:
              "Optional one sentence explaining what the query does.",
          },
          suggestedCharts: { type: "array", items: { type: "string" } },
          lookbackHours: {
            type: "number",
            description:
              "Log-based sources only: the time window (hours back) the final query should run over (default 24). Ignored for table/SQL sources.",
          },
        },
        required: ["answer"],
      },
    },
  },
};

const RUN_JAVASCRIPT_TOOL: Tool = {
  toolSpec: {
    name: "run_javascript",
    description:
      "Transform or compute over the rows returned by your most recent run_query, using JavaScript, when it's awkward to express in the query language (reshaping, custom aggregation, deriving values). `rows` holds ALL rows of that result (up to a large cap), not just the small sample shown in the query result — so aggregations cover the full set. The code runs as a function body with `rows` (an array of row objects keyed by column name) and `columns` (array of names) in scope, and must `return` its result. It is sandboxed: no filesystem, network, or host access — pure computation over the provided rows only. Run a query first so there is data to operate on. If the result reports it was truncated, prefer expressing the aggregate in the query (SQL) for an exact answer.",
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
  rows: string[][]; // a bounded sample shown to the model, not necessarily all rows
  /**
   * A fuller row set (up to a large cap) for run_javascript to compute over,
   * so JS aggregations aren't silently limited to the model's small sample.
   * Falls back to `rows` when absent.
   */
  allRows?: string[][];
  rowCount: number;
  error?: string;
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
  // priorTurns MUST be a strictly alternating user,assistant,… sequence ending
  // with an assistant turn, so that appending the new user question below
  // yields the user/assistant alternation Bedrock Converse requires (it rejects
  // consecutive same-role messages). recordTurn() upholds this: it always
  // pushes a user+assistant pair and slices to an even MAX_TURNS. If you change
  // how turns are recorded, preserve that invariant or this Converse call will
  // start failing.
  const messages: Message[] = [
    ...(opts.priorTurns ?? []).map((t) => ({
      role: t.role,
      content: [{ text: t.text }],
    })),
    { role: "user", content: [{ text: opts.question }] },
  ];
  const tried = new Set<string>();
  let lastGoodQuery: string | undefined;
  // Number of queries actually executed (not counting oscillation-blocked
  // repeats). A single Converse turn can emit several parallel run_query
  // blocks, so we bound QUERIES — the Athena-billing-relevant unit — by
  // maxIterations, not just Converse turns.
  let queriesRun = 0;
  // The most recent run_query result, so run_javascript can compute over it.
  // Holds the fuller row set (allRows), the true total, and the source query
  // (to warn about a LIMIT), so JS operates on more than the display sample.
  let lastResult:
    | { columns: string[]; rows: string[][]; totalRows: number; query: string }
    | undefined;

  // Handle one run_query tool-use: run it (with oscillation guard), update
  // state + emit a step, and return the payload for its toolResult.
  const handleRunQuery = async (tu: ToolUseBlock): Promise<unknown> => {
    const inp = (tu.input ?? {}) as {
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
      // Oscillation guard. This tool loop lets the model recover: feed back an
      // error tool-result and let it choose a different query or finish (costs
      // one iteration). That differs deliberately from the verify/refine loop
      // (extension.ts onGenerateAgentic), which BREAKS on a repeat — there the
      // model just regenerates the same single-shot query, so continuing is
      // pointless; here the model has agency to change course.
      result = {
        columns: [],
        rows: [],
        rowCount: 0,
        error:
          "You already ran this exact query and its result is above. Try a different query or call finish.",
      };
    } else {
      tried.add(norm);
      queriesRun += 1;
      result = await opts.runQuery(query, lookbackHours);
      if (!result.error) {
        lastGoodQuery = query;
        lastResult = {
          columns: result.columns,
          rows: result.allRows ?? result.rows,
          totalRows: result.rowCount,
          query,
        };
      }
    }

    opts.onStep({
      kind: result.error ? "error" : "query",
      query,
      purpose,
      rowCount: result.error ? undefined : result.rowCount,
      detail: result.error ?? purpose,
    });

    return result.error
      ? { error: result.error }
      : {
          columns: result.columns,
          rowCount: result.rowCount,
          sampleRows: result.rows,
        };
  };

  // Handle one run_javascript tool-use: run the code over the full result set
  // in the sandbox, emit a step, and return the payload for its toolResult.
  const handleRunJs = async (tu: ToolUseBlock): Promise<unknown> => {
    const jinp = (tu.input ?? {}) as { code?: string; purpose?: string };
    const code = (jinp.code ?? "").trim();
    const jsPurpose =
      typeof jinp.purpose === "string" ? jinp.purpose : undefined;
    let payload: unknown;
    if (!code) {
      payload = { error: "No code provided." };
    } else if (!lastResult) {
      payload = { error: "No data yet — run a query with run_query first." };
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
      if (!sandbox.ok) {
        payload = { error: sandbox.error };
      } else {
        const notes: string[] = [];
        // The JS input was capped below the number of rows loaded.
        if (objectRows.length < lastResult.totalRows) {
          notes.push(
            `Computed over the first ${objectRows.length} of ${lastResult.totalRows} rows loaded; for an exact aggregate over the full result, express it in the query (SQL) instead.`,
          );
        }
        // The source query itself was LIMITed, so the rows loaded may be only
        // a subset of all matching rows — an aggregate here can be partial even
        // when nothing was capped above.
        if (/\blimit\s+\d+/i.test(lastResult.query)) {
          notes.push(
            "The source query used a LIMIT, so these rows may be a subset of all matching rows — a total/median/sum computed here can be partial. For a full-set aggregate, remove the LIMIT or aggregate in the query (SQL).",
          );
        }
        // Bound the marshalled result: it's JSON-serialized straight into the
        // toolResult sent back to the model, so a huge return value would
        // inflate tokens/cost. Reject oversized results and tell the model to
        // return a summary instead.
        const serialized = JSON.stringify(sandbox.value ?? null);
        if (serialized.length > JS_RESULT_MAX_CHARS) {
          payload = {
            error: `The returned value is too large (${serialized.length} characters; limit ${JS_RESULT_MAX_CHARS}). Return a small summary or aggregate, not raw rows.`,
          };
        } else {
          payload = {
            result: sandbox.value,
            ...(notes.length ? { notes } : {}),
          };
        }
      }
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
    return payload;
  };

  const toolResultBlock = (
    tu: ToolUseBlock,
    payload: unknown,
  ): ContentBlock => ({
    toolResult: {
      toolUseId: tu.toolUseId,
      content: [{ text: JSON.stringify(payload) }],
    },
  });

  for (let i = 0; i < opts.maxIterations; i++) {
    const response = await client.send(
      new ConverseCommand({
        modelId: opts.modelId,
        system: [{ text: system }],
        messages,
        toolConfig: {
          tools: [RUN_QUERY_TOOL, RUN_JAVASCRIPT_TOOL, FINISH_TOOL],
        },
        // Generous cap: a finish call can carry answer + a multi-line query +
        // explanation + suggestedCharts, plus run_javascript can emit a chunk
        // of code — 1024 could truncate those mid-tool-call.
        inferenceConfig: { maxTokens: 4096, temperature: 0 },
      }),
    );
    const message = response.output?.message;
    if (!message) break;
    messages.push(message);

    const blocks: ContentBlock[] = message.content ?? [];
    const toolUses = blocks
      .map((b) => ("toolUse" in b ? b.toolUse : undefined))
      .filter((t): t is ToolUseBlock => !!t);

    if (toolUses.length === 0) {
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

    // If the model called finish, honor it and return. Any parallel tool calls
    // in the same turn don't need answering — we're not sending another
    // Converse request, so their toolResults aren't required.
    const finishUse = toolUses.find((t) => t.name === "finish");
    if (finishUse) {
      const inp = (finishUse.input ?? {}) as {
        query?: string;
        explanation?: string;
        answer?: string;
        suggestedCharts?: string[];
        lookbackHours?: number;
      };
      opts.onStep({
        kind: "finish",
        query: inp.query,
        detail: inp.explanation,
      });
      return {
        // Respect a deliberately-omitted query: the finish spec tells the
        // model to leave `query` out for conceptual/metadata answers so NO
        // table is shown. Falling back to lastGoodQuery here would resurrect
        // an unrelated exploration query and render a misleading table.
        query: (inp.query ?? "").trim(),
        explanation: (inp.explanation ?? "").trim(),
        answer:
          typeof inp.answer === "string" && inp.answer.trim()
            ? inp.answer.trim()
            : undefined,
        suggestedCharts: Array.isArray(inp.suggestedCharts)
          ? inp.suggestedCharts
          : undefined,
        lookbackHours:
          typeof inp.lookbackHours === "number" && inp.lookbackHours > 0
            ? inp.lookbackHours
            : undefined,
      };
    }

    // Otherwise run EVERY tool-use block and answer with one toolResult per
    // toolUseId. Bedrock Converse requires a matching toolResult for each
    // toolUseId in the next user message, so a parallel/multi tool-use turn
    // must be answered in full or the next request fails validation.
    const toolResults: ContentBlock[] = [];
    for (const tu of toolUses) {
      const payload =
        tu.name === "run_javascript"
          ? await handleRunJs(tu)
          : await handleRunQuery(tu);
      toolResults.push(toolResultBlock(tu, payload));
    }
    messages.push({ role: "user", content: toolResults });

    // Bound total queries (not just Converse turns): a turn with several
    // parallel run_query blocks could otherwise run more Athena scans than the
    // configured cap.
    if (queriesRun >= opts.maxIterations) {
      opts.onStep({
        kind: "note",
        detail: `Reached the query budget (${opts.maxIterations}); stopping and answering from what was gathered.`,
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
