/**
 * The AI query pipeline (Ask / Agent / raw "query" mode), extracted from the VS
 * Code ExplorerPanel so it's vscode-free and reusable by non-VS-Code hosts (the
 * standalone desktop app). It owns the conversation history and posts the same
 * webview messages via an injected `post` callback. All AWS/query work goes
 * through the existing vscode-free modules (llm, agentLoop, per-destination
 * runners, queryShape/queryValidator).
 */
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import type { InsightConfig } from "./configCore";
import {
  generateQuery,
  verifyResult,
  analyzeResults,
  setLocalModel,
  setLocalServer,
  type GeneratedQuery,
} from "./llm";
import {
  runAgentLoop,
  type AgentQueryResult,
  type ConversationTurn,
} from "./agentLoop";
import { runLogsInsightsQuery } from "./logsInsights";
import { runDynamoDBQuery } from "./dynamodb";
import { runAuroraQuery } from "./aurora";
import { runRedshiftQuery } from "./redshift";
import { runOpenSearchQuery } from "./opensearch";
import { runAthenaQuery } from "./athena";
import { ensureLimit } from "./schema";
import { assertReadOnly } from "./queryValidator";
import {
  ensureIdentifierColumn,
  isAggregateQuery,
  resolveActualColumnCasing,
  resolveActualColumns,
} from "./queryShape";

/** The composer's query mode. */
export type QueryMode = "query" | "ask" | "agent";

/**
 * Current AI-usage disclosure version the user must have accepted before any
 * LLM-backed action runs. Kept in sync with AI_DISCLOSURE_VERSION in
 * webview-ui/src/types.ts — bump both together when the disclosure wording
 * changes so consented users are re-prompted.
 */
export const REQUIRED_AI_DISCLOSURE_VERSION = "2";

export interface QueryExecution {
  columns: string[];
  rows: string[][];
  count?: number;
  /** True if the result was capped at MAX_SQL_ROWS (more rows exist than returned). */
  truncated?: boolean;
  /** Per-column numeric-type flag (aligned with `columns`), for typed run_javascript input. */
  numericColumns?: boolean[];
  explanation?: string;
  suggestedCharts?: string[];
  finalQuery: string;
  idColumn?: string;
  partitionColumns?: { year?: string; month?: string; day?: string };
  hiddenColumns?: string[];
}

/**
 * The query dialect for a destination, for shape checks like isAggregateQuery.
 */
function queryDialect(destinationType: string): "sql" | "logs-insights" {
  return destinationType === "cloudwatch-logs-exporter" ||
    destinationType === "lambda-log-exporter"
    ? "logs-insights"
    : "sql";
}

/** Max rows handed to run_javascript (fuller set than the model's sample). */
export const JS_ROW_CAP = 5000;

/** Hard ceiling on rows loaded from a SQL destination for one query. */
export const MAX_SQL_ROWS = 10000;

/** Default CloudWatch Logs Insights time window (24h) for "query" mode. */
export const DEFAULT_TIME_RANGE_MS = 86_400_000;

/** Whether a query-execution error is worth asking the model to fix. */
function isRetryableQueryError(msg: string): boolean {
  return (
    msg.includes("MalformedQueryException") ||
    msg.includes("ValidationException") ||
    msg.includes("Athena query failed") ||
    msg.includes("INVALID_") ||
    msg.includes("SYNTAX_ERROR")
  );
}

/** Extra fix-it guidance for a COLUMN_NOT_FOUND failure. */
function columnNotFoundHint(msg: string): string {
  return msg.includes("COLUMN_NOT_FOUND")
    ? "\n\nThis is likely because a field that lives inside input/output was referenced as a bare column instead of via json_extract_scalar(input, '$.path') / json_extract_scalar(output, '$.path') — check every column reference (including in GROUP BY/ORDER BY) against the schema's actual top-level columns."
    : "";
}

/** Normalize a query for the agentic loop's "already tried this" check. */
function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Message sink: the host delivers these to the webview. */
type PostFn = (msg: { type: string } & Record<string, unknown>) => void;

export class QueryService {
  // Summarized advanced-mode conversation, so follow-up questions continue the
  // session. Cleared on "newSession".
  private conversation: ConversationTurn[] = [];

  constructor(private readonly post: PostFn) {}

  /** Reset the conversation history (host "newSession"). */
  clearConversation(): void {
    this.conversation = [];
  }

  /**
   * Entry point for a "generate" message. Dispatches by mode: query (no LLM),
   * ask (single-shot), agent (agentic loop). Consent is re-checked host-side.
   */
  async runGenerate(
    question: string,
    mode: QueryMode,
    cfg: InsightConfig,
    credentials: AwsCredentialIdentityProvider,
  ): Promise<void> {
    const q = question.trim();
    if (!q) {
      this.post({ type: "error", message: "Enter a question first." });
      return;
    }
    setLocalModel(cfg.localModel);
    setLocalServer(cfg.localServerUrl, cfg.localServerModel);
    const tableName =
      cfg.destinationType === "dynamodb"
        ? cfg.dynamodbTableName
        : cfg.destinationType === "aurora"
          ? cfg.auroraTable
          : cfg.destinationType === "redshift"
            ? `${cfg.redshiftSchema}.${cfg.redshiftTable}`
            : cfg.destinationType === "opensearch"
              ? cfg.opensearchIndex
              : cfg.destinationType === "s3"
                ? cfg.athenaTable
                : undefined;
    if (mode === "query") {
      return await this.onRunRawQuery(q, cfg, credentials);
    }
    if (!this.hasAiConsent(cfg)) {
      this.post({
        type: "error",
        message:
          "AI features require accepting the AI-usage disclosure first. Please try again and accept the notice.",
      });
      return;
    }
    if (mode === "ask") {
      return await this.onGenerateSingleShot(q, cfg, credentials, tableName);
    }
    return await this.onGenerateAgentic(q, cfg, credentials, tableName);
  }
  private async onRunRawQuery(
    q: string,
    cfg: InsightConfig,
    credentials: AwsCredentialIdentityProvider,
  ): Promise<void> {
    this.post({ type: "status", text: "Running query..." });
    const exec = await this.executeQuery(
      cfg,
      credentials,
      { query: q, explanation: "", timeRangeMs: DEFAULT_TIME_RANGE_MS },
      { injectDrillDown: false },
    );
    // Query mode has no LLM prose, so post an explicit summary — otherwise a
    // 0-row result (e.g. a query whose language doesn't match the configured
    // destination) looks like nothing happened.
    const n = exec.count ?? exec.rows.length;
    this.post({
      type: "agentAnswer",
      text:
        n > 0
          ? `Ran your query — returned ${n} row${n === 1 ? "" : "s"}${exec.truncated ? " (capped)" : ""}.`
          : `Ran your query — 0 rows returned. If you expected data, check that your query matches the configured destination's query language (${cfg.destinationType}).`,
    });
    this.post({ type: "results", ...exec });
  }

  /**
   * "ask" mode: one LLM NL→query translation, run once, present. No agent
   * loop, no verify/refine — a single query the model writes for the question.
   */
  private async onGenerateSingleShot(
    q: string,
    cfg: InsightConfig,
    credentials: AwsCredentialIdentityProvider,
    tableName: string | undefined,
  ): Promise<void> {
    this.post({ type: "status", text: "Generating query..." });
    const generated = await generateQuery({
      provider: cfg.llmProvider,
      region: cfg.region,
      credentials,
      modelId: cfg.bedrockModelId,
      question: this.withConversationContext(q),
      destinationType: cfg.destinationType,
      tableName,
    });
    this.post({ type: "status", text: "Running query..." });
    const exec = await this.executeQuery(cfg, credentials, generated);
    this.post({ type: "results", ...exec });
    this.recordTurn(
      q,
      generated.explanation ||
        `Returned ${exec.count ?? exec.rows.length} row(s).`,
    );
  }

  /** Persist the composer's query mode as the default for next time. */
  private hasAiConsent(cfg: { aiDisclosureAcceptedVersion: string }): boolean {
    return cfg.aiDisclosureAcceptedVersion === REQUIRED_AI_DISCLOSURE_VERSION;
  }

  /**
   * Agentic generation: run the query, then ask the model whether the results
   * actually answer the question; if not, refine the query and try again, up
   * to a small cap. Emits "agentStep" transcript messages so the webview can
   * show the loop's progress. Read-only enforcement, identifier injection, and
   * partition pruning all go through executeQuery. Dispatches to the Bedrock
   * multi-step tool loop when available.
   */
  private async onGenerateAgentic(
    q: string,
    cfg: InsightConfig,
    credentials: AwsCredentialIdentityProvider,
    tableName: string | undefined,
  ): Promise<void> {
    // The full multi-turn "explore then answer" agent loop (run_query/finish)
    // needs Bedrock's Converse tool use. Use it for every queryable
    // destination under Bedrock (SQS isn't queryable and never reaches here).
    // Copilot/local keep the generate→verify→refine loop below.
    if (cfg.llmProvider === "bedrock" && cfg.destinationType !== "sqs") {
      return await this.onGenerateAgenticToolLoop(q, cfg, credentials);
    }

    const MAX_ITERATIONS = cfg.agenticMaxIterations;

    this.post({ type: "status", text: "Generating query..." });
    let generated = await generateQuery({
      provider: cfg.llmProvider,
      region: cfg.region,
      credentials,
      modelId: cfg.bedrockModelId,
      question: this.withConversationContext(q),
      destinationType: cfg.destinationType,
      tableName,
      agentic: true,
    });

    let lastExec: QueryExecution | undefined;
    // Queries already attempted (normalized), so a loop that starts repeating
    // itself stops early instead of burning the whole iteration budget on the
    // same failing/unhelpful query — the higher the cap, the more this matters.
    const tried = new Set<string>();

    for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
      const norm = normalizeQuery(generated.query);
      if (tried.has(norm)) {
        // Oscillation guard. This single-shot verify/refine loop BREAKS on a
        // repeat: the model regenerated the same query, so further refine
        // rounds would just repeat it. (The Bedrock tool loop instead feeds an
        // error back and lets the model pick a different query or finish — see
        // agentLoop.ts — because there the model has tool-driven agency to
        // change course rather than re-emitting one query.)
        this.post({
          type: "agentStep",
          iteration: iter,
          query: generated.query,
          outcome: "error",
          detail:
            "Stopped: the model repeated a query it had already tried, so more attempts won't help.",
        });
        break;
      }
      tried.add(norm);

      this.post({
        type: "status",
        text: `Agentic step ${iter}/${MAX_ITERATIONS}: running query...`,
      });

      let exec: QueryExecution;
      try {
        // Inject drill-down/partition columns for row-level result sets so
        // each row can be clicked for its full record. Skip it for aggregate
        // queries (and post-process raw fetches); ensureIdentifierColumn also
        // safely bails on DISTINCT/set-operator/derived shapes it can't
        // rewrite without corrupting. Decided by query shape, not a model
        // flag, so drill-down is consistent across providers.
        exec = await this.executeQuery(cfg, credentials, generated, {
          injectDrillDown:
            !isAggregateQuery(
              generated.query,
              queryDialect(cfg.destinationType),
            ) && !generated.postProcess,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.post({
          type: "agentStep",
          iteration: iter,
          query: generated.query,
          outcome: "error",
          detail: msg,
        });
        if (isRetryableQueryError(msg) && iter < MAX_ITERATIONS) {
          this.post({
            type: "status",
            text: "Query failed, asking the model to fix it...",
          });
          generated = await generateQuery({
            provider: cfg.llmProvider,
            region: cfg.region,
            credentials,
            modelId: cfg.bedrockModelId,
            question: this.withConversationContext(
              `${q}\n\nThe previous query failed with this error: ${msg}${columnNotFoundHint(msg)}\nPlease fix the query.`,
            ),
            destinationType: cfg.destinationType,
            tableName,
            agentic: true,
          });
          continue;
        }
        throw err;
      }

      lastExec = exec;

      // If the model chose to fetch raw data for a post-processing step (it
      // set postProcess=true because the answer was awkward to express in the
      // query language), answer the question from those rows via an LLM
      // analysis step instead of the verify/refine loop.
      if (generated.postProcess) {
        this.post({
          type: "status",
          text: `Agentic step ${iter}/${MAX_ITERATIONS}: analyzing results...`,
        });
        const answer = await analyzeResults({
          provider: cfg.llmProvider,
          region: cfg.region,
          credentials,
          modelId: cfg.bedrockModelId,
          question: q,
          goal: generated.postProcessGoal,
          columns: exec.columns,
          rows: exec.rows,
        });
        this.post({
          type: "agentStep",
          iteration: iter,
          query: exec.finalQuery,
          rowCount: exec.count ?? exec.rows.length,
          outcome: "analyzed",
          detail:
            generated.postProcessGoal ??
            "Post-processed the returned rows to answer the question.",
        });
        if (answer) this.post({ type: "agentAnswer", text: answer });
        this.post({ type: "results", ...exec });
        this.recordTurn(q, answer || "Post-processed the results to answer.");
        return;
      }

      // Judge whether the results answer the question.
      this.post({
        type: "status",
        text: `Agentic step ${iter}/${MAX_ITERATIONS}: checking results...`,
      });
      const rowCount = exec.count ?? exec.rows.length;
      const verdict = await verifyResult({
        provider: cfg.llmProvider,
        region: cfg.region,
        credentials,
        modelId: cfg.bedrockModelId,
        question: q,
        query: exec.finalQuery,
        columns: exec.columns,
        rowCount,
        sampleRows: exec.rows.slice(0, 5),
      });

      this.post({
        type: "agentStep",
        iteration: iter,
        query: exec.finalQuery,
        rowCount,
        outcome: verdict.satisfied ? "satisfied" : "unsatisfied",
        detail: verdict.reason,
      });

      if (verdict.satisfied || iter === MAX_ITERATIONS) {
        // Produce a conversational prose answer (works on every provider) so
        // the reply isn't just a table — parity with the Bedrock tool loop.
        // analyzeResults is a second model call, so skip it for empty results:
        // the verdict reason already explains an empty set well (e.g. "no
        // failed executions") and it isn't worth the extra round-trip.
        let answer = "";
        if (rowCount > 0) {
          this.post({ type: "status", text: "Writing the answer..." });
          answer = await analyzeResults({
            provider: cfg.llmProvider,
            region: cfg.region,
            credentials,
            modelId: cfg.bedrockModelId,
            question: q,
            columns: exec.columns,
            rows: exec.rows,
          });
        }
        const prose = answer || verdict.reason;
        if (prose) this.post({ type: "agentAnswer", text: prose });
        this.post({ type: "results", ...exec });
        // Record the turn so follow-ups have conversation context (threaded
        // back in via withConversationContext on the next question).
        this.recordTurn(q, prose || `Returned ${rowCount} row(s).`);
        return;
      }

      // Refine and try again.
      this.post({
        type: "status",
        text: `Refining query (step ${iter + 1}/${MAX_ITERATIONS})...`,
      });
      const suggestion = verdict.suggestion
        ? `\nSuggested fix: ${verdict.suggestion}`
        : "";
      generated = await generateQuery({
        provider: cfg.llmProvider,
        region: cfg.region,
        credentials,
        modelId: cfg.bedrockModelId,
        question: this.withConversationContext(
          `${q}\n\nA previous attempt ran this query:\n${exec.finalQuery}\n\nIt returned ${rowCount} row(s), but that did not adequately answer the question because: ${verdict.reason}${suggestion}\nPlease produce an improved query.`,
        ),
        destinationType: cfg.destinationType,
        tableName,
        agentic: true,
      });
    }

    // The loop returns as soon as it has an answer; reaching here means it
    // stopped early (repeated query) or exhausted its iterations. Show the
    // best result we got, or surface a clear error if we never got one.
    if (lastExec) {
      this.post({ type: "results", ...lastExec });
    } else {
      this.post({
        type: "error",
        message:
          "The assistant couldn't produce a working query for this question within its iteration budget. Try rephrasing, or raise workflowInsight.agenticMaxIterations.",
      });
    }
  }

  /**
   * Advanced mode, Bedrock + SQL destinations: the full "explore then answer"
   * agent loop. The model uses run_query to discover the data's shape (e.g.
   * which keys exist in input/output) and compute candidates — seeing real
   * columns/rows each time — then calls finish with the query that answers the
   * question. Exploration and the final presentation run use the SAME
   * query-shape drill-down injection, so when the model finishes with a query
   * it already explored, the executed SQL is identical and the result is
   * reused from queryCache instead of being scanned (billed) a second time.
   * The number of queries is bounded by agenticMaxIterations.
   */
  private async onGenerateAgenticToolLoop(
    q: string,
    cfg: InsightConfig,
    credentials: AwsCredentialIdentityProvider,
  ): Promise<void> {
    const tableName =
      cfg.destinationType === "dynamodb"
        ? cfg.dynamodbTableName
        : cfg.destinationType === "aurora"
          ? cfg.auroraTable
          : cfg.destinationType === "redshift"
            ? `${cfg.redshiftSchema}.${cfg.redshiftTable}`
            : cfg.destinationType === "opensearch"
              ? cfg.opensearchIndex
              : cfg.destinationType === "s3"
                ? cfg.athenaTable
                : undefined;

    let iteration = 0;
    // The most recent successful query execution, so a turn that ends with a
    // prose-only answer (the model explored with run_query, then answered
    // without a distinct "final" query) still shows the data it fetched —
    // matching the "every data question shows its table" expectation.
    let lastExec: QueryExecution | undefined;
    // Per-question cache of raw query results (keyed by executed query text),
    // shared by the exploration run_query calls and the final presentation
    // run — so the finish query, already scanned during exploration, isn't
    // scanned again for presentation when the SQL is identical.
    const queryCache = new Map<
      string,
      { columns: string[]; rows: string[][] }
    >();

    // Each run_query the model issues: run it read-only and return a bounded
    // sample. Injection uses the SAME query-shape decision as the final
    // presentation run, so when the model finishes with a query it already
    // explored, the executed SQL is identical and the queryCache hits — no
    // second Athena scan (see the final executeQuery call below). lookbackHours
    // (log-based sources only) sets the search window. The number of queries
    // is bounded by agenticMaxIterations.
    const runQuery = async (
      query: string,
      lookbackHours?: number,
    ): Promise<AgentQueryResult> => {
      try {
        const exec = await this.executeQuery(
          cfg,
          credentials,
          {
            query,
            explanation: "",
            timeRangeMs: (lookbackHours ?? 24) * 60 * 60 * 1000,
          },
          {
            injectDrillDown: !isAggregateQuery(
              query,
              queryDialect(cfg.destinationType),
            ),
            queryCache,
          },
        );
        // Remember the latest successful, row-bearing execution so a
        // prose-only finish can still present it (see the answer-only branch).
        if (exec.rows.length > 0) lastExec = exec;
        return {
          columns: exec.columns,
          // Small sample for the model's context; run_javascript gets the
          // fuller set (capped) so its aggregations aren't limited to 20 rows.
          rows: exec.rows.slice(0, 20),
          allRows: exec.rows.slice(0, JS_ROW_CAP),
          rowCount: exec.count ?? exec.rows.length,
          truncated: exec.truncated,
          numericColumns: exec.numericColumns,
        };
      } catch (err) {
        return {
          columns: [],
          rows: [],
          rowCount: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    };

    this.post({ type: "status", text: "Working on your question..." });

    const final = await runAgentLoop({
      region: cfg.region,
      credentials,
      modelId: cfg.bedrockModelId,
      question: q,
      destinationType: cfg.destinationType,
      tableName,
      maxIterations: cfg.agenticMaxIterations,
      priorTurns: this.conversation,
      runQuery,
      onStep: (e) => {
        iteration += 1;
        this.post({
          type: "agentStep",
          iteration,
          query: e.query ?? "",
          rowCount: e.rowCount,
          outcome:
            e.kind === "error"
              ? "error"
              : e.kind === "finish"
                ? "satisfied"
                : e.kind === "note"
                  ? "unsatisfied"
                  : e.kind === "script"
                    ? "script"
                    : "ran",
          detail: e.detail,
        });
        this.post({
          type: "status",
          text:
            e.kind === "finish"
              ? "Preparing the answer..."
              : `Agent step ${iteration}: ${e.purpose ?? "running a query"}...`,
        });
      },
    });

    if (!final || !final.query) {
      // No usable query. If the model produced any prose, still show it and
      // record the turn so the conversation continues. If it explored real
      // rows on the way to that answer, present the latest of those too so the
      // turn still shows its data table.
      const proseOnly = final?.answer || final?.explanation;
      if (proseOnly) {
        this.post({ type: "agentAnswer", text: proseOnly });
        if (lastExec) this.post({ type: "results", ...lastExec });
        this.recordTurn(q, proseOnly);
        return;
      }
      this.post({
        type: "error",
        message:
          "The assistant couldn't arrive at a query that answers this question. Try rephrasing, or raise workflowInsight.agenticMaxIterations.",
      });
      return;
    }

    // Run the final query for presentation, with the normal drill-down
    // decision (row-level results get the identifier/partition columns).
    this.post({ type: "status", text: "Running the final query..." });
    const exec = await this.executeQuery(
      cfg,
      credentials,
      {
        query: final.query,
        explanation: final.explanation,
        timeRangeMs: (final.lookbackHours ?? 24) * 60 * 60 * 1000,
        suggestedCharts: final.suggestedCharts,
      },
      {
        injectDrillDown: !isAggregateQuery(
          final.query,
          queryDialect(cfg.destinationType),
        ),
        queryCache,
      },
    );
    // The prose reply is the answer; fall back to the explanation so the
    // conversation never shows a bare "here are the results" placeholder.
    const prose = final.answer || final.explanation;
    if (prose) this.post({ type: "agentAnswer", text: prose });
    this.post({ type: "results", ...exec });
    // Record the turn so follow-up questions have this exchange as context.
    this.recordTurn(
      q,
      prose ||
        `Returned ${exec.count ?? exec.rows.length} row(s) for: ${final.query}`,
    );
  }

  /**
   * Prefix a question with a compact transcript of the current conversation,
   * so the single-shot verify/refine path (Copilot/local) gets the same
   * follow-up context the Bedrock tool loop gets via priorTurns. Without it, a
   * follow-up like "now only the failed ones" would generate cold, with no
   * idea what "those" referred to. Returns the question unchanged when there's
   * no history yet.
   */
  private withConversationContext(question: string): string {
    if (this.conversation.length === 0) return question;
    const history = this.conversation
      .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`)
      .join("\n");
    return `Earlier in this conversation:\n${history}\n\nCurrent question: ${question}`;
  }

  /**
   * Append a completed exchange to the advanced-mode conversation history, so
   * the next question continues the session. Trims the history to a bounded
   * number of recent turns to keep prompt size (and cost) in check.
   */
  private recordTurn(question: string, answer: string): void {
    this.conversation.push({ role: "user", text: question });
    this.conversation.push({ role: "assistant", text: answer });
    const MAX_TURNS = 12; // 6 user+assistant pairs
    if (this.conversation.length > MAX_TURNS) {
      this.conversation = this.conversation.slice(-MAX_TURNS);
    }
  }

  /**
   * Run a single generated query against the configured destination and return
   * the normalized results payload (the body of a "results" message, minus the
   * type). Shared by both provider paths (the Bedrock tool loop and the
   * verify/refine loop) so there is exactly one place that enforces read-only
   * access, injects the identifier/partition columns, and runs the
   * per-destination query engine. Throws on execution errors
   * (the caller decides whether to retry).
   */
  private async executeQuery(
    cfg: InsightConfig,
    credentials: AwsCredentialIdentityProvider,
    generated: GeneratedQuery,
    opts?: {
      injectDrillDown?: boolean;
      /**
       * Per-question cache of raw query results keyed by the exact executed
       * query string. Lets the tool loop reuse a result it already scanned
       * during exploration instead of re-running the same SQL for
       * presentation — avoids double-billing the scan (esp. Athena). A cache
       * hit only happens when the executed query text is identical, i.e. when
       * drill-down injection added nothing; otherwise the SQL differs and we
       * (correctly) run it. Not used for the time-windowed CloudWatch path,
       * whose result depends on the wall-clock window, not just the query.
       */
      queryCache?: Map<string, { columns: string[]; rows: string[][] }>;
    },
  ): Promise<QueryExecution> {
    // Whether to inject the drill-down identifier (and Athena partition)
    // columns into the query. Callers pass false for exploration/analytical
    // queries; the agentic paths decide by query shape (isAggregateQuery), so
    // an analytical query (DISTINCT/UNNEST/aggregate/derived) runs exactly as
    // written instead of being corrupted by columns that aren't in its scope.
    // ensureIdentifierColumn is itself conservative and bails on shapes it
    // can't rewrite safely, so injection is a no-op there even if requested.
    const inject = opts?.injectDrillDown ?? true;
    const queryCache = opts?.queryCache;
    // Run a query unless its exact text was already run this question, in
    // which case reuse the cached result (no second scan).
    const runOnce = async <T extends { columns: string[]; rows: string[][] }>(
      key: string,
      run: () => Promise<T>,
    ): Promise<T> => {
      const hit = queryCache?.get(key);
      if (hit) return hit as T;
      const res = await run();
      queryCache?.set(key, res);
      return res;
    };
    // Enforce the host row ceiling uniformly. Athena's runner already stops
    // paging at MAX_SQL_ROWS (and sets truncated); Aurora/DynamoDB return a
    // single API response (bounded by the service's ~1 MB reply), but slice
    // them too so the guarantee holds for every SQL destination.
    const capRows = <
      T extends { columns: string[]; rows: string[][]; truncated?: boolean },
    >(
      table: T,
    ): { rows: string[][]; count: number; truncated: boolean } => {
      const overCap = table.rows.length > MAX_SQL_ROWS;
      const rows = overCap ? table.rows.slice(0, MAX_SQL_ROWS) : table.rows;
      return {
        rows,
        count: rows.length,
        truncated: !!table.truncated || overCap,
      };
    };
    if (cfg.destinationType === "dynamodb") {
      if (!cfg.dynamodbTableName)
        throw new Error("No DynamoDB table configured.");
      assertReadOnly(generated.query, "PartiQL");
      const { query, idColumn, injectedColumns } = inject
        ? ensureIdentifierColumn(generated.query, "pk", "sql")
        : {
            query: generated.query,
            idColumn: undefined,
            injectedColumns: [] as string[],
          };
      const table = await runOnce(query, () =>
        runDynamoDBQuery({
          region: cfg.region,
          credentials,
          tableName: cfg.dynamodbTableName,
          statement: query,
        }),
      );
      const capped = capRows(table);
      return {
        ...table,
        ...capped,
        explanation: generated.explanation,
        suggestedCharts: generated.suggestedCharts,
        finalQuery: query,
        idColumn: resolveActualColumnCasing(idColumn, table.columns),
        hiddenColumns: resolveActualColumns(injectedColumns, table.columns),
      };
    }
    if (cfg.destinationType === "aurora") {
      if (!cfg.auroraResourceArn || !cfg.auroraSecretArn)
        throw new Error("Aurora not configured.");
      assertReadOnly(generated.query, "PostgreSQL");
      const { query, idColumn, injectedColumns } = inject
        ? ensureIdentifierColumn(generated.query, "execution_arn", "sql")
        : {
            query: generated.query,
            idColumn: undefined,
            injectedColumns: [] as string[],
          };
      const table = await runOnce(query, () =>
        runAuroraQuery({
          region: cfg.region,
          credentials,
          resourceArn: cfg.auroraResourceArn,
          secretArn: cfg.auroraSecretArn,
          database: cfg.auroraDatabase,
          sql: query,
        }),
      );
      const capped = capRows(table);
      return {
        ...table,
        ...capped,
        explanation: generated.explanation,
        suggestedCharts: generated.suggestedCharts,
        finalQuery: query,
        idColumn: resolveActualColumnCasing(idColumn, table.columns),
        hiddenColumns: resolveActualColumns(injectedColumns, table.columns),
      };
    }
    if (cfg.destinationType === "redshift") {
      if (!cfg.redshiftWorkgroupName && !cfg.redshiftClusterIdentifier)
        throw new Error("Redshift not configured.");
      assertReadOnly(generated.query, "Redshift SQL");
      const { query, idColumn, injectedColumns } = inject
        ? ensureIdentifierColumn(generated.query, "execution_arn", "sql")
        : {
            query: generated.query,
            idColumn: undefined,
            injectedColumns: [] as string[],
          };
      const table = await runOnce(query, () =>
        runRedshiftQuery({
          region: cfg.region,
          credentials,
          database: cfg.redshiftDatabase,
          workgroupName: cfg.redshiftWorkgroupName || undefined,
          clusterIdentifier: cfg.redshiftClusterIdentifier || undefined,
          dbUser: cfg.redshiftDbUser || undefined,
          secretArn: cfg.redshiftSecretArn || undefined,
          sql: query,
        }),
      );
      const capped = capRows(table);
      return {
        ...table,
        ...capped,
        explanation: generated.explanation,
        suggestedCharts: generated.suggestedCharts,
        finalQuery: query,
        idColumn: resolveActualColumnCasing(idColumn, table.columns),
        hiddenColumns: resolveActualColumns(injectedColumns, table.columns),
      };
    }
    if (cfg.destinationType === "opensearch") {
      if (!cfg.opensearchEndpoint)
        throw new Error("OpenSearch not configured.");
      assertReadOnly(generated.query, "OpenSearch SQL");
      const { query, idColumn, injectedColumns } = inject
        ? ensureIdentifierColumn(generated.query, "executionArn", "sql")
        : {
            query: generated.query,
            idColumn: undefined,
            injectedColumns: [] as string[],
          };
      const table = await runOnce(query, () =>
        runOpenSearchQuery({
          region: cfg.region,
          credentials,
          endpoint: cfg.opensearchEndpoint,
          sql: query,
        }),
      );
      const capped = capRows(table);
      return {
        ...table,
        ...capped,
        explanation: generated.explanation,
        suggestedCharts: generated.suggestedCharts,
        finalQuery: query,
        idColumn: resolveActualColumnCasing(idColumn, table.columns),
        hiddenColumns: resolveActualColumns(injectedColumns, table.columns),
      };
    }
    if (cfg.destinationType === "s3") {
      if (!cfg.athenaDatabase) throw new Error("Athena not configured.");
      assertReadOnly(generated.query, "Trino/Presto SQL");
      // The openx JSON SerDe lowercases all keys, so the identifier column
      // the LLM's SQL would reference is "executionarn", not "executionArn" —
      // match that here too (see schema.ts's Athena dialect notes on key
      // casing). Also carry the year/month/day partition columns through so
      // the row-detail fetch can prune to one partition instead of scanning
      // the whole table (see fetchAthenaRecord's doc comment).
      const { query, idColumn, injectedColumns } = inject
        ? ensureIdentifierColumn(generated.query, "executionarn", "sql", [
            "year",
            "month",
            "day",
          ])
        : {
            query: generated.query,
            idColumn: undefined,
            injectedColumns: [] as string[],
          };
      const table = await runOnce(query, () =>
        runAthenaQuery({
          region: cfg.region,
          credentials,
          database: cfg.athenaDatabase,
          workgroup: cfg.athenaWorkgroup || undefined,
          outputLocation: cfg.athenaOutputLocation || undefined,
          query,
          maxRows: MAX_SQL_ROWS,
        }),
      );
      const capped = capRows(table);
      return {
        ...table,
        ...capped,
        explanation: generated.explanation,
        suggestedCharts: generated.suggestedCharts,
        finalQuery: query,
        idColumn: resolveActualColumnCasing(idColumn, table.columns),
        partitionColumns: {
          year: resolveActualColumnCasing("year", table.columns),
          month: resolveActualColumnCasing("month", table.columns),
          day: resolveActualColumnCasing("day", table.columns),
        },
        hiddenColumns: resolveActualColumns(injectedColumns, table.columns),
      };
    }
    // CloudWatch Logs path
    const limited = ensureLimit(generated.query);
    const {
      query: finalQuery,
      idColumn,
      injectedColumns,
    } = inject
      ? ensureIdentifierColumn(limited, "executionArn", "logs-insights")
      : {
          query: limited,
          idColumn: undefined,
          injectedColumns: [] as string[],
        };
    const endTimeMs = Date.now();
    const startTimeMs = endTimeMs - generated.timeRangeMs;
    const table = await runLogsInsightsQuery({
      region: cfg.region,
      credentials,
      logGroupNames: cfg.logGroupNames,
      queryString: finalQuery,
      startTimeMs,
      endTimeMs,
    });
    return {
      ...table,
      explanation: generated.explanation,
      suggestedCharts: generated.suggestedCharts,
      finalQuery,
      idColumn: resolveActualColumnCasing(idColumn, table.columns),
      hiddenColumns: resolveActualColumns(injectedColumns, table.columns),
    };
  }

  /**
   * Fetch the full record for a single row, keyed by the identifier column
   * ensureIdentifierColumn added to the query (idColumn/idValue from the
   * webview's row-click). Dispatches to the destination-appropriate
   * point-lookup. Aggregate query results never carry an idColumn (see
   * queryShape.ts), so the webview never sends this message for those —
   * this handler doesn't need to re-check that.
   */
}
