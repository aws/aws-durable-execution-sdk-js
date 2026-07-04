import * as vscode from "vscode";
import { readConfig, resolveCredentials } from "./config";
import {
  generateQuery,
  verifyResult,
  analyzeResults,
  isModelDownloaded,
  ensureModel,
  type GeneratedQuery,
} from "./llm";
import { runAgentLoop, type AgentQueryResult } from "./agentLoop";
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
  resolveActualColumnCasing,
  resolveActualColumns,
} from "./queryShape";

type InboundMessage =
  | { type: "ready" }
  | { type: "generate"; question: string }
  | { type: "saveSettings"; settings: Record<string, string> }
  | { type: "downloadModel" }
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
  /** Athena only: bytes scanned by this query (for the agentic cost guard). */
  dataScannedBytes?: number;
}

/**
 * Whether a query-execution error is worth asking the model to fix (a
 * malformed/invalid query) versus a hard failure (missing config, no
 * permissions) that a retry can't help. Kept identical to the condition the
 * basic path has always used, so both modes retry on exactly the same errors.
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
        case "saveSettings":
          return await this.onSaveSettings(msg.settings);
        case "downloadModel":
          return await this.onDownloadModel();
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
        agenticMode: cfg.agenticMode,
        agenticMaxIterations: String(cfg.agenticMaxIterations),
        agenticMaxScannedMB: String(cfg.agenticMaxScannedMB),
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
      } else if (key === "agenticMaxScannedMB") {
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

  private async onDownloadModel(): Promise<void> {
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
    const credentials = resolveCredentials(cfg.awsProfile);
    const tableName =
      cfg.destinationType === "dynamodb"
        ? cfg.dynamodbTableName
        : cfg.destinationType === "aurora"
          ? cfg.auroraTable
          : cfg.destinationType === "s3"
            ? cfg.athenaTable
            : undefined;

    // "advanced" (agentic) mode adds a result-verification/refine loop on top
    // of the basic flow. Basic mode is unchanged — same single generation,
    // same run, same error-only retry.
    if (cfg.agenticMode === "advanced") {
      return await this.onGenerateAgentic(q, cfg, credentials, tableName);
    }

    this.post({ type: "status", text: "Generating query..." });
    let generated = await generateQuery({
      provider: cfg.llmProvider,
      region: cfg.region,
      credentials,
      modelId: cfg.bedrockModelId,
      question: q,
      destinationType: cfg.destinationType,
      tableName,
    });
    console.log(
      "[insight] LLM response:",
      JSON.stringify({
        query: generated.query.substring(0, 80),
        suggestedCharts: generated.suggestedCharts,
      }),
    );

    for (let attempt = 0; attempt < 3; attempt++) {
      this.post({
        type: "status",
        text: attempt === 0 ? "Running query..." : `Retrying (${attempt}/2)...`,
      });
      try {
        const exec = await this.executeQuery(cfg, credentials, generated);
        this.post({ type: "results", ...exec });
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isRetryableQueryError(msg) && attempt < 2) {
          this.post({
            type: "status",
            text: "Query failed, asking Bedrock to fix...",
          });
          generated = await generateQuery({
            provider: cfg.llmProvider,
            region: cfg.region,
            credentials,
            modelId: cfg.bedrockModelId,
            question: `${q}\n\nThe previous query failed with this error: ${msg}${columnNotFoundHint(msg)}\nPlease fix the query.`,
            destinationType: cfg.destinationType,
            tableName,
          });
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Advanced ("agentic") generation: run the query, then ask the model whether
   * the results actually answer the question; if not, refine the query and try
   * again, up to a small cap. Emits "agentStep" transcript messages so the
   * webview can show the loop's progress. Read-only enforcement, identifier
   * injection, and partition pruning are identical to basic mode (both go
   * through executeQuery). Only reached when agenticMode === "advanced".
   */
  private async onGenerateAgentic(
    q: string,
    cfg: ReturnType<typeof readConfig>,
    credentials: ReturnType<typeof resolveCredentials>,
    tableName: string | undefined,
  ): Promise<void> {
    // The full multi-turn "explore then answer" agent loop (run_query/finish)
    // needs Bedrock's Converse tool use and a self-contained query per turn.
    // Use it for Bedrock + SQL destinations; Copilot/local and Logs Insights
    // (which needs a separate time range) keep the generate→verify→refine
    // loop below.
    if (
      cfg.llmProvider === "bedrock" &&
      (cfg.destinationType === "dynamodb" ||
        cfg.destinationType === "aurora" ||
        cfg.destinationType === "s3")
    ) {
      return await this.onGenerateAgenticToolLoop(q, cfg, credentials);
    }

    const MAX_ITERATIONS = cfg.agenticMaxIterations;

    this.post({ type: "status", text: "Generating query..." });
    let generated = await generateQuery({
      provider: cfg.llmProvider,
      region: cfg.region,
      credentials,
      modelId: cfg.bedrockModelId,
      question: q,
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
        // Only inject drill-down/partition columns when the model marked the
        // result row-level (and it isn't a post-process raw fetch). Otherwise
        // run the query exactly as written — injecting into an aggregate/
        // DISTINCT/UNNEST/derived query corrupts it (columns not in scope).
        exec = await this.executeQuery(cfg, credentials, generated, {
          injectDrillDown:
            generated.rowLevel === true && !generated.postProcess,
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
            question: `${q}\n\nThe previous query failed with this error: ${msg}${columnNotFoundHint(msg)}\nPlease fix the query.`,
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
        this.post({ type: "results", ...exec });
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
        question: `${q}\n\nA previous attempt ran this query:\n${exec.finalQuery}\n\nIt returned ${rowCount} row(s), but that did not adequately answer the question because: ${verdict.reason}${suggestion}\nPlease produce an improved query.`,
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
   * question. Exploration queries run WITHOUT drill-down injection (read-only,
   * exactly as written); only the final query gets the normal drill-down
   * treatment for presentation. A cumulative Athena scan budget bounds cost.
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
          : cfg.athenaTable;

    const maxScannedBytes = cfg.agenticMaxScannedMB * 1024 * 1024;
    let scannedBytes = 0;
    let iteration = 0;

    // Each run_query the model issues: run it read-only, no drill-down
    // injection, return a bounded sample. Enforce the cumulative Athena scan
    // budget so an autonomous loop can't run up cost.
    const runQuery = async (query: string): Promise<AgentQueryResult> => {
      try {
        const exec = await this.executeQuery(
          cfg,
          credentials,
          {
            query,
            explanation: "",
            timeRangeMs: 24 * 60 * 60 * 1000,
          },
          { injectDrillDown: false },
        );
        if (typeof exec.dataScannedBytes === "number") {
          scannedBytes += exec.dataScannedBytes;
        }
        const overBudget = scannedBytes > maxScannedBytes;
        return {
          columns: exec.columns,
          rows: exec.rows.slice(0, 20),
          rowCount: exec.count ?? exec.rows.length,
          stop: overBudget,
          stopReason: overBudget
            ? `Athena scan budget of ${cfg.agenticMaxScannedMB} MB reached; stopping.`
            : undefined,
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
      // No usable query. If the model produced a prose answer, still show it.
      if (final?.answer) {
        this.post({ type: "agentAnswer", text: final.answer });
        return;
      }
      this.post({
        type: "error",
        message:
          "The assistant couldn't arrive at a query that answers this question. Try rephrasing, or raise workflowInsight.agenticMaxIterations / agenticMaxScannedMB.",
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
        timeRangeMs: 24 * 60 * 60 * 1000,
        suggestedCharts: final.suggestedCharts,
      },
      { injectDrillDown: final.rowLevel === true },
    );
    if (final.answer) this.post({ type: "agentAnswer", text: final.answer });
    this.post({ type: "results", ...exec });
  }

  /**
   * Run a single generated query against the configured destination and return
   * the normalized results payload (the body of a "results" message, minus the
   * type). Shared by basic and advanced modes so there is exactly one place
   * that enforces read-only access, injects the identifier/partition columns,
   * and runs the per-destination query engine. Throws on execution errors
   * (the caller decides whether to retry).
   */
  private async executeQuery(
    cfg: ReturnType<typeof readConfig>,
    credentials: ReturnType<typeof resolveCredentials>,
    generated: GeneratedQuery,
    opts?: { injectDrillDown?: boolean },
  ): Promise<QueryExecution> {
    // Whether to inject the drill-down identifier (and Athena partition)
    // columns into the query. Basic mode always does (default true). Advanced
    // mode passes false unless the model flagged the result as row-level, so
    // an analytical query (DISTINCT/UNNEST/aggregate/derived) runs exactly as
    // written instead of being corrupted by columns that aren't in its scope.
    const inject = opts?.injectDrillDown ?? true;
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
      const table = await runDynamoDBQuery({
        region: cfg.region,
        credentials,
        tableName: cfg.dynamodbTableName,
        statement: query,
      });
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
      const table = await runAuroraQuery({
        region: cfg.region,
        credentials,
        resourceArn: cfg.auroraResourceArn,
        secretArn: cfg.auroraSecretArn,
        database: cfg.auroraDatabase,
        sql: query,
      });
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
      const table = await runAthenaQuery({
        region: cfg.region,
        credentials,
        database: cfg.athenaDatabase,
        workgroup: cfg.athenaWorkgroup || undefined,
        outputLocation: cfg.athenaOutputLocation || undefined,
        query,
      });
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
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "media", "webview.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "media", "webview.css"),
    );
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
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++)
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
