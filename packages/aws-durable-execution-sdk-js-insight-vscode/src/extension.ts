import * as vscode from "vscode";
import { readConfig, resolveCredentials } from "./config";
import { generateQuery, isModelDownloaded, ensureModel } from "./llm";
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
      const coerced: string | boolean | undefined =
        key === "sqsDeleteAfterRead" ? value === "true" : value || undefined;
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
        if (cfg.destinationType === "dynamodb") {
          if (!cfg.dynamodbTableName)
            throw new Error("No DynamoDB table configured.");
          assertReadOnly(generated.query, "PartiQL");
          const { query, idColumn, injectedColumns } = ensureIdentifierColumn(
            generated.query,
            "pk",
            "sql",
          );
          const table = await runDynamoDBQuery({
            region: cfg.region,
            credentials,
            tableName: cfg.dynamodbTableName,
            statement: query,
          });
          this.post({
            type: "results",
            ...table,
            explanation: generated.explanation,
            suggestedCharts: generated.suggestedCharts,
            finalQuery: query,
            idColumn: resolveActualColumnCasing(idColumn, table.columns),
            hiddenColumns: resolveActualColumns(injectedColumns, table.columns),
          });
          return;
        }
        if (cfg.destinationType === "aurora") {
          if (!cfg.auroraResourceArn || !cfg.auroraSecretArn)
            throw new Error("Aurora not configured.");
          assertReadOnly(generated.query, "PostgreSQL");
          const { query, idColumn, injectedColumns } = ensureIdentifierColumn(
            generated.query,
            "execution_arn",
            "sql",
          );
          const table = await runAuroraQuery({
            region: cfg.region,
            credentials,
            resourceArn: cfg.auroraResourceArn,
            secretArn: cfg.auroraSecretArn,
            database: cfg.auroraDatabase,
            sql: query,
          });
          this.post({
            type: "results",
            ...table,
            explanation: generated.explanation,
            suggestedCharts: generated.suggestedCharts,
            finalQuery: query,
            idColumn: resolveActualColumnCasing(idColumn, table.columns),
            hiddenColumns: resolveActualColumns(injectedColumns, table.columns),
          });
          return;
        }
        if (cfg.destinationType === "s3") {
          if (!cfg.athenaDatabase) throw new Error("Athena not configured.");
          assertReadOnly(generated.query, "Trino/Presto SQL");
          // The openx JSON SerDe lowercases all keys, so the identifier
          // column the LLM's SQL would reference is "executionarn", not
          // "executionArn" — match that here too (see schema.ts's Athena
          // dialect notes on key casing). Also carry the year/month/day
          // partition columns through so the row-detail fetch can prune to
          // one partition instead of scanning the whole table (see
          // fetchAthenaRecord's doc comment).
          const { query, idColumn, injectedColumns } = ensureIdentifierColumn(
            generated.query,
            "executionarn",
            "sql",
            ["year", "month", "day"],
          );
          const table = await runAthenaQuery({
            region: cfg.region,
            credentials,
            database: cfg.athenaDatabase,
            workgroup: cfg.athenaWorkgroup || undefined,
            outputLocation: cfg.athenaOutputLocation || undefined,
            query,
          });
          this.post({
            type: "results",
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
          });
          return;
        }
        // CloudWatch Logs path
        {
          const limited = ensureLimit(generated.query);
          const {
            query: finalQuery,
            idColumn,
            injectedColumns,
          } = ensureIdentifierColumn(limited, "executionArn", "logs-insights");
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
          this.post({
            type: "results",
            ...table,
            explanation: generated.explanation,
            suggestedCharts: generated.suggestedCharts,
            finalQuery,
            idColumn: resolveActualColumnCasing(idColumn, table.columns),
            hiddenColumns: resolveActualColumns(injectedColumns, table.columns),
          });
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          (msg.includes("MalformedQueryException") ||
            msg.includes("ValidationException") ||
            msg.includes("Athena query failed") ||
            msg.includes("INVALID_") ||
            msg.includes("SYNTAX_ERROR")) &&
          attempt < 2
        ) {
          this.post({
            type: "status",
            text: "Query failed, asking Bedrock to fix...",
          });
          const hint = msg.includes("COLUMN_NOT_FOUND")
            ? "\n\nThis is likely because a field that lives inside input/output was referenced as a bare column instead of via json_extract_scalar(input, '$.path') / json_extract_scalar(output, '$.path') — check every column reference (including in GROUP BY/ORDER BY) against the schema's actual top-level columns."
            : "";
          generated = await generateQuery({
            provider: cfg.llmProvider,
            region: cfg.region,
            credentials,
            modelId: cfg.bedrockModelId,
            question: `${q}\n\nThe previous query failed with this error: ${msg}${hint}\nPlease fix the query.`,
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
