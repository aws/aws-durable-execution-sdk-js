import * as vscode from "vscode";
import { readConfig, resolveCredentials } from "./config";
import { generateQuery, isModelDownloaded, ensureModel } from "./llm";
import { runLogsInsightsQuery } from "./logsInsights";
import { runDynamoDBQuery } from "./dynamodb";
import { runAuroraQuery } from "./aurora";
import { listenToQueue, type SqsMessageRow } from "./sqs";
import { ensureLimit } from "./schema";
import { assertReadOnly } from "./queryValidator";

type InboundMessage =
  | { type: "ready" }
  | { type: "generate"; question: string }
  | { type: "saveSettings"; settings: Record<string, string> }
  | { type: "downloadModel" }
  | { type: "exportChart"; format: "svg" | "png"; content: string }
  | { type: "startListening" }
  | { type: "stopListening" };

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
    this.post({ type: "settingsSaved" });
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
          const table = await runDynamoDBQuery({
            region: cfg.region,
            credentials,
            tableName: cfg.dynamodbTableName,
            statement: generated.query,
          });
          this.post({
            type: "results",
            ...table,
            explanation: generated.explanation,
            suggestedCharts: generated.suggestedCharts,
            finalQuery: generated.query,
          });
          return;
        }
        if (cfg.destinationType === "aurora") {
          if (!cfg.auroraResourceArn || !cfg.auroraSecretArn)
            throw new Error("Aurora not configured.");
          assertReadOnly(generated.query, "PostgreSQL");
          const table = await runAuroraQuery({
            region: cfg.region,
            credentials,
            resourceArn: cfg.auroraResourceArn,
            secretArn: cfg.auroraSecretArn,
            database: cfg.auroraDatabase,
            sql: generated.query,
          });
          this.post({
            type: "results",
            ...table,
            explanation: generated.explanation,
            suggestedCharts: generated.suggestedCharts,
            finalQuery: generated.query,
          });
          return;
        }
        // CloudWatch Logs path
        const finalQuery = ensureLimit(generated.query);
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
        });
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          (msg.includes("MalformedQueryException") ||
            msg.includes("ValidationException")) &&
          attempt < 2
        ) {
          this.post({
            type: "status",
            text: "Query failed, asking Bedrock to fix...",
          });
          generated = await generateQuery({
            provider: cfg.llmProvider,
            region: cfg.region,
            credentials,
            modelId: cfg.bedrockModelId,
            question: `${q}\n\nThe previous query failed with this error: ${msg}\nPlease fix the query.`,
            destinationType: cfg.destinationType,
            tableName,
          });
          continue;
        }
        throw err;
      }
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
