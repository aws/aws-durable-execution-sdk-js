import * as vscode from "vscode";
import * as fs from "fs";
import { readConfig, resolveCredentials } from "./config";
import {
  generateQuery,
  verifyResult,
  analyzeResults,
  isModelDownloaded,
  ensureModel,
  setLocalModel,
  type GeneratedQuery,
} from "./llm";
import {
  runAgentLoop,
  type AgentQueryResult,
  type ConversationTurn,
} from "./agentLoop";
import { runLogsInsightsQuery, fetchLogsInsightsRecord } from "./logsInsights";
import { runDynamoDBQuery, fetchDynamoDBRecord } from "./dynamodb";
import { runAuroraQuery, fetchAuroraRecord } from "./aurora";
import {
  runAthenaQuery,
  ensureAthenaTable,
  tableExists,
  fetchAthenaRecord,
} from "./athena";
import { listenToQueue, type SqsMessageRow } from "./sqs";
import { ensureLimit } from "./schema";
import { assertReadOnly } from "./queryValidator";
import {
  ensureIdentifierColumn,
  isAggregateQuery,
  resolveActualColumnCasing,
  resolveActualColumns,
} from "./queryShape";

type InboundMessage =
  | { type: "ready" }
  | { type: "generate"; question: string }
  | { type: "newSession" }
  | { type: "saveSettings"; settings: Record<string, string> }
  | { type: "downloadModel"; localModel?: string }
  | { type: "exportChart"; format: "svg" | "png"; content: string }
  | { type: "startListening" }
  | { type: "stopListening" }
  | {
      type: "fetchDetail";
      idColumn: string;
      idValue: string;
      year?: string;
      month?: string;
      day?: string;
    };

/**
 * Normalized results payload: the body of a "results" message minus its
 * `type`. Produced by ExplorerPanel.executeQuery and shared by both basic and
 * advanced (agentic) generation paths.
 */
interface QueryExecution {
  columns: string[];
  rows: string[][];
  count?: number;
  explanation?: string;
  suggestedCharts?: string[];
  finalQuery: string;
  idColumn?: string;
  partitionColumns?: { year?: string; month?: string; day?: string };
  hiddenColumns?: string[];
}

/**
 * The query dialect for a destination, for shape checks like isAggregateQuery.
 * The two log-exporter destinations use CloudWatch Logs Insights; everything
 * else (DynamoDB PartiQL, Aurora PostgreSQL, S3/Athena Trino) is SQL-shaped.
 */
function queryDialect(destinationType: string): "sql" | "logs-insights" {
  return destinationType === "cloudwatch-logs-exporter" ||
    destinationType === "lambda-log-exporter"
    ? "logs-insights"
    : "sql";
}

/**
 * Max rows handed to run_javascript. The model sees only a small sample, but
 * JS computes over this fuller set so aggregations aren't silently limited.
 * Bounded so a huge result can't overwhelm the sandbox/host; when the true
 * result exceeds it, the JS result reports the truncation so the model can
 * fall back to a SQL aggregate.
 */
const JS_ROW_CAP = 5000;

/**
 * Whether a query-execution error is worth asking the model to fix (a
 * malformed/invalid query) versus a hard failure (missing config, no
 * permissions) that a retry can't help. Destination-agnostic, so every
 * provider path retries on exactly the same class of errors.
 */
function isRetryableQueryError(msg: string): boolean {
  return (
    msg.includes("MalformedQueryException") ||
    msg.includes("ValidationException") ||
    msg.includes("Athena query failed") ||
    msg.includes("INVALID_") ||
    msg.includes("SYNTAX_ERROR")
  );
}

/**
 * Extra guidance appended to a fix-it prompt when the failure is a
 * COLUMN_NOT_FOUND (the classic "referenced an input/output JSON field as a
 * bare column" mistake). Empty for any other error.
 */
function columnNotFoundHint(msg: string): string {
  return msg.includes("COLUMN_NOT_FOUND")
    ? "\n\nThis is likely because a field that lives inside input/output was referenced as a bare column instead of via json_extract_scalar(input, '$.path') / json_extract_scalar(output, '$.path') — check every column reference (including in GROUP BY/ORDER BY) against the schema's actual top-level columns."
    : "";
}

/**
 * Normalize a query for the agentic loop's "already tried this" check: trim,
 * collapse runs of whitespace, and lowercase, so trivially-different but
 * effectively-identical regenerations (reindented, recased) are recognized as
 * repeats and stop the loop instead of wasting an iteration.
 */
function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("workflowInsight.openExplorer", () => {
      ExplorerPanel.show(context.extensionUri);
    }),
  );
}

export function deactivate(): void {}

class ExplorerPanel {
  private static current: ExplorerPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private listenController: AbortController | undefined;
  // Summarized advanced-mode conversation (user questions + assistant answers),
  // so follow-up questions continue the session. Cleared on "newSession".
  private conversation: ConversationTurn[] = [];

  static show(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (ExplorerPanel.current) {
      ExplorerPanel.current.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "workflowInsightExplorer",
      "Workflow Insight Explorer",
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      },
    );
    ExplorerPanel.current = new ExplorerPanel(panel, extensionUri);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
  ) {
    this.panel.webview.html = this.getHtml(this.panel.webview, extensionUri);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: InboundMessage) => this.handleMessage(msg),
      null,
      this.disposables,
    );
  }

  private async handleMessage(msg: InboundMessage): Promise<void> {
    try {
      switch (msg.type) {
        case "ready":
          return this.sendConfig();
        case "generate":
          return await this.onGenerate(msg.question);
        case "newSession":
          this.conversation = [];
          this.post({ type: "sessionCleared" });
          return;
        case "saveSettings":
          return await this.onSaveSettings(msg.settings);
        case "downloadModel":
          return await this.onDownloadModel(msg.localModel);
        case "exportChart":
          return await this.onExportChart(msg.format, msg.content);
        case "startListening":
          return this.onStartListening();
        case "stopListening":
          return this.onStopListening();
        case "fetchDetail":
          return await this.onFetchDetail(
            msg.idColumn,
            msg.idValue,
            msg.year,
            msg.month,
            msg.day,
          );
      }
    } catch (err) {
      this.post({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private sendConfig(): void {
    const cfg = readConfig();
    // Reflect the selected local model so isModelDownloaded() below (and any
    // local generation) targets the right file.
    setLocalModel(cfg.localModel);
    this.post({
      type: "config",
      settings: {
        region: cfg.region,
        destinationType: cfg.destinationType,
        logGroupName: cfg.logGroupNames.join(", "),
        dynamodbTableName: cfg.dynamodbTableName,
        auroraResourceArn: cfg.auroraResourceArn,
        auroraSecretArn: cfg.auroraSecretArn,
        auroraDatabase: cfg.auroraDatabase,
        auroraTable: cfg.auroraTable,
        sqsQueueUrl: cfg.sqsQueueUrl,
        sqsDeleteAfterRead: cfg.sqsDeleteAfterRead,
        athenaDatabase: cfg.athenaDatabase,
        athenaTable: cfg.athenaTable,
        athenaWorkgroup: cfg.athenaWorkgroup,
        athenaOutputLocation: cfg.athenaOutputLocation,
        athenaS3Location: cfg.athenaS3Location,
        llmProvider: cfg.llmProvider,
        awsProfile: cfg.awsProfile ?? "",
        bedrockModelId: cfg.bedrockModelId,
        localModel: cfg.localModel,
        agenticMaxIterations: String(cfg.agenticMaxIterations),
      },
      modelDownloaded: isModelDownloaded(),
    });
  }

  private async onSaveSettings(
    settings: Record<string, string>,
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration("workflowInsight");
    for (const [key, value] of Object.entries(settings)) {
      // sqsDeleteAfterRead is boolean-typed in the settings schema; the
      // webview always sends strings, so coerce it before writing. `false` is
      // a meaningful value here, so it must not be treated as "unset".
      // agenticMaxIterations is number-typed — coerce likewise (invalid/empty
      // falls back to undefined so the schema default applies).
      let coerced: string | boolean | number | undefined;
      if (key === "sqsDeleteAfterRead") {
        coerced = value === "true";
      } else if (key === "agenticMaxIterations") {
        const n = Number(value);
        coerced = Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
      } else {
        coerced = value || undefined;
      }
      await config.update(key, coerced, vscode.ConfigurationTarget.Global);
    }
    this.sendConfig();

    const cfg = readConfig();
    if (
      cfg.destinationType === "s3" &&
      cfg.athenaDatabase &&
      cfg.athenaS3Location
    ) {
      await this.onEnsureAthenaTable(cfg);
    }

    this.post({ type: "settingsSaved" });
  }

  /**
   * Auto-create (or verify) the Glue table backing Athena queries, and
   * discover any Hive partitions S3Exporter has already written. Idempotent —
   * safe to run every time settings are saved. Best-effort: surfaces failures
   * as a non-fatal warning rather than blocking settings from saving, since
   * the user may not have Glue/Athena permissions yet (or the bucket/table
   * exist already via other tooling).
   */
  private async onEnsureAthenaTable(
    cfg: ReturnType<typeof readConfig>,
  ): Promise<void> {
    const credentials = resolveCredentials(cfg.awsProfile);
    try {
      const exists = await tableExists({
        region: cfg.region,
        credentials,
        database: cfg.athenaDatabase,
        table: cfg.athenaTable,
      });
      if (exists) return;

      this.post({
        type: "status",
        text: `Creating Glue table ${cfg.athenaDatabase}.${cfg.athenaTable}...`,
      });
      await ensureAthenaTable({
        region: cfg.region,
        credentials,
        database: cfg.athenaDatabase,
        table: cfg.athenaTable,
        workgroup: cfg.athenaWorkgroup || undefined,
        outputLocation: cfg.athenaOutputLocation || undefined,
        s3Location: cfg.athenaS3Location,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.post({
        type: "error",
        message: `Saved settings, but couldn't auto-create the Athena table: ${msg}`,
      });
    }
  }

  private async onDownloadModel(localModel?: string): Promise<void> {
    // Download the model the user picked in settings (may not be saved yet),
    // falling back to the saved selection.
    setLocalModel(localModel ?? readConfig().localModel);
    if (isModelDownloaded()) {
      this.post({ type: "downloadProgress", percent: 100, done: true });
      return;
    }
    await ensureModel((text) => {
      const match = text.match(/(\d+)%/);
      const percent = match ? Number(match[1]) : 0;
      this.post({ type: "downloadProgress", percent, done: false });
    });
    this.post({ type: "downloadProgress", percent: 100, done: true });
  }

  private async onExportChart(
    format: "svg" | "png",
    content: string,
  ): Promise<void> {
    const ext = format === "svg" ? "svg" : "png";
    const uri = await vscode.window.showSaveDialog({
      filters: { [format.toUpperCase()]: [ext] },
      defaultUri: vscode.Uri.file(`chart.${ext}`),
    });
    if (!uri) return;

    if (format === "svg") {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
    } else {
      // content is a data URL: data:image/png;base64,...
      const base64 = content.split(",")[1];
      await vscode.workspace.fs.writeFile(uri, Buffer.from(base64, "base64"));
    }
    vscode.window.showInformationMessage(`Chart saved to ${uri.fsPath}`);
  }

  private onStartListening(): void {
    if (this.listenController) return; // already listening
    const cfg = readConfig();
    if (!cfg.sqsQueueUrl) {
      this.post({
        type: "error",
        message: "No SQS queue configured. Set workflowInsight.sqsQueueUrl.",
      });
      return;
    }

    const controller = new AbortController();
    this.listenController = controller;
    this.post({ type: "sqsStatus", listening: true });

    void listenToQueue({
      region: cfg.region,
      credentials: resolveCredentials(cfg.awsProfile),
      queueUrl: cfg.sqsQueueUrl,
      deleteAfterRead: cfg.sqsDeleteAfterRead,
      signal: controller.signal,
      onMessages: (messages: SqsMessageRow[]) =>
        this.post({ type: "sqsMessages", messages }),
      onError: (error) => this.post({ type: "error", message: error.message }),
    }).finally(() => {
      // Only clear/notify if this call owns the current controller — a newer
      // start/stop may have already replaced it.
      if (this.listenController === controller) {
        this.listenController = undefined;
        this.post({ type: "sqsStatus", listening: false });
      }
    });
  }

  private onStopListening(): void {
    this.listenController?.abort();
    this.listenController = undefined;
    this.post({ type: "sqsStatus", listening: false });
  }

  private async onGenerate(question: string): Promise<void> {
    const q = question.trim();
    if (!q) {
      this.post({ type: "error", message: "Enter a question first." });
      return;
    }
    const cfg = readConfig();
    setLocalModel(cfg.localModel);
    const credentials = resolveCredentials(cfg.awsProfile);
    const tableName =
      cfg.destinationType === "dynamodb"
        ? cfg.dynamodbTableName
        : cfg.destinationType === "aurora"
          ? cfg.auroraTable
          : cfg.destinationType === "s3"
            ? cfg.athenaTable
            : undefined;

    // The assistant always works agentically. The dispatch inside picks the
    // Bedrock multi-step tool loop or the verify/refine loop by provider.
    return await this.onGenerateAgentic(q, cfg, credentials, tableName);
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
    cfg: ReturnType<typeof readConfig>,
    credentials: ReturnType<typeof resolveCredentials>,
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
    cfg: ReturnType<typeof readConfig>,
    credentials: ReturnType<typeof resolveCredentials>,
  ): Promise<void> {
    const tableName =
      cfg.destinationType === "dynamodb"
        ? cfg.dynamodbTableName
        : cfg.destinationType === "aurora"
          ? cfg.auroraTable
          : cfg.destinationType === "s3"
            ? cfg.athenaTable
            : undefined;

    let iteration = 0;
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
        return {
          columns: exec.columns,
          // Small sample for the model's context; run_javascript gets the
          // fuller set (capped) so its aggregations aren't limited to 20 rows.
          rows: exec.rows.slice(0, 20),
          allRows: exec.rows.slice(0, JS_ROW_CAP),
          rowCount: exec.count ?? exec.rows.length,
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
      // record the turn so the conversation continues.
      const proseOnly = final?.answer || final?.explanation;
      if (proseOnly) {
        this.post({ type: "agentAnswer", text: proseOnly });
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
    cfg: ReturnType<typeof readConfig>,
    credentials: ReturnType<typeof resolveCredentials>,
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
      return {
        ...table,
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
      return {
        ...table,
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
        }),
      );
      return {
        ...table,
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
  private async onFetchDetail(
    idColumn: string,
    idValue: string,
    year?: string,
    month?: string,
    day?: string,
  ): Promise<void> {
    const cfg = readConfig();
    const credentials = resolveCredentials(cfg.awsProfile);
    try {
      let record: Record<string, string> | undefined;
      if (cfg.destinationType === "dynamodb") {
        record = await fetchDynamoDBRecord({
          region: cfg.region,
          credentials,
          tableName: cfg.dynamodbTableName,
          pk: idValue,
        });
      } else if (cfg.destinationType === "aurora") {
        record = await fetchAuroraRecord({
          region: cfg.region,
          credentials,
          resourceArn: cfg.auroraResourceArn,
          secretArn: cfg.auroraSecretArn,
          database: cfg.auroraDatabase,
          table: cfg.auroraTable,
          executionArn: idValue,
        });
      } else if (cfg.destinationType === "s3") {
        record = await fetchAthenaRecord({
          region: cfg.region,
          credentials,
          database: cfg.athenaDatabase,
          table: cfg.athenaTable,
          workgroup: cfg.athenaWorkgroup || undefined,
          outputLocation: cfg.athenaOutputLocation || undefined,
          executionArn: idValue,
          year,
          month,
          day,
        });
      } else {
        record = await fetchLogsInsightsRecord({
          region: cfg.region,
          credentials,
          logGroupNames: cfg.logGroupNames,
          executionArn: idValue,
        });
      }

      if (!record) {
        this.post({
          type: "error",
          message: `Couldn't find a record for ${idColumn} = ${idValue}.`,
        });
        return;
      }
      this.post({ type: "detailResult", fields: record });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.post({
        type: "error",
        message: `Failed to fetch record detail: ${msg}`,
      });
    }
  }

  private post(message: Record<string, unknown>): void {
    void this.panel.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = getNonce();
    // Cache-bust the webview assets: VS Code caches them by URI, so without a
    // changing query param a rebuilt media/webview.js|css can be served stale
    // even after relaunching. Keying on the bundle's mtime changes the URI
    // whenever the build changes, forcing a reload.
    const version = this.assetVersion(extensionUri);
    const scriptUri = webview
      .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "webview.js"))
      .with({ query: `v=${version}` });
    const styleUri = webview
      .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "webview.css"))
      .with({ query: `v=${version}` });
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data: blob:`,
      `connect-src data: blob:`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Workflow Insight Explorer</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    ExplorerPanel.current = undefined;
    this.listenController?.abort();
    this.listenController = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  /**
   * A version token for the webview assets, derived from media/webview.js's
   * last-modified time, so the asset URLs change whenever the bundle is
   * rebuilt (defeating VS Code's webview asset cache). Also logged on open so
   * you can confirm which build is actually running.
   */
  private assetVersion(extensionUri: vscode.Uri): string {
    try {
      const p = vscode.Uri.joinPath(extensionUri, "media", "webview.js").fsPath;
      const mtime = fs.statSync(p).mtimeMs;
      const stamp = Math.floor(mtime);
      console.log(
        `[workflow-insight] webview bundle build stamp: ${new Date(mtime).toISOString()} (v=${stamp})`,
      );
      return String(stamp);
    } catch {
      return String(Date.now());
    }
  }
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++)
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
