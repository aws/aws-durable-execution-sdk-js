/**
 * The VS Code host for Workflow Insight.
 *
 * This file is an adapter and nothing more. It owns the webview panel's
 * lifecycle, implements {@link HostPort} in terms of the VS Code API, and hands
 * every inbound message to {@link ExplorerSession}, which holds the actual
 * behavior and is shared with the Electron desktop app.
 *
 * If you are adding a feature, it almost certainly belongs in
 * explorerSession.ts. Only add code here when it is genuinely VS Code specific
 * — a panel, a dialog, a settings write.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import { readConfig, SECTION, type InsightConfig } from "./config";
import {
  setCopilotBridge,
  type CopilotBridge,
  type CopilotModel,
  ExplorerSession,
  type InboundMessage,
  type Favorite,
  type HostPort,
  type PromptRequest,
  type SaveFileRequest,
  type SettingValue,
} from "@aws/durable-insight-core";

export function activate(context: vscode.ExtensionContext): void {
  // Copilot-backed generation lives behind a port so llm.ts stays host-free;
  // this is the only place the Language Model API is reachable.
  setCopilotBridge(createVsCodeCopilotBridge());
  context.subscriptions.push(
    vscode.commands.registerCommand("workflowInsight.openExplorer", () => {
      ExplorerPanel.show(context.extensionUri, context.globalState);
    }),
  );
}

export function deactivate(): void {
  setCopilotBridge(undefined);
}

/**
 * Adapts VS Code's Language Model API to the {@link CopilotBridge} port.
 * `sendRequest` streams, so each call concatenates the chunks and disposes its
 * cancellation source.
 */
function createVsCodeCopilotBridge(): CopilotBridge {
  return {
    async selectModel(): Promise<CopilotModel | null> {
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      if (models.length === 0) return null;
      const model = models[0];
      return {
        async send(userMessages: string[]): Promise<string> {
          const cts = new vscode.CancellationTokenSource();
          try {
            const response = await model.sendRequest(
              userMessages.map((m) => vscode.LanguageModelChatMessage.User(m)),
              {},
              cts.token,
            );
            let text = "";
            for await (const chunk of response.text) text += chunk;
            return text;
          } finally {
            cts.dispose();
          }
        },
      };
    },
    async listAllModelIds(): Promise<string[]> {
      const all = await vscode.lm.selectChatModels();
      return all.map((m) => `${m.vendor}/${m.family}/${m.id}`);
    },
  };
}

/** {@link HostPort} implemented against a VS Code webview panel. */
class VsCodeHost implements HostPort {
  private static readonly favoritesKey = "workflowInsight.favorites";

  constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly globalState: vscode.Memento,
  ) {}

  post(message: Record<string, unknown>): void {
    void this.panel.webview.postMessage(message);
  }

  readConfig(): InsightConfig {
    return readConfig();
  }

  async writeSettings(values: Record<string, SettingValue>): Promise<void> {
    const config = vscode.workspace.getConfiguration(SECTION);
    for (const [key, value] of Object.entries(values)) {
      await config.update(key, value, vscode.ConfigurationTarget.Global);
    }
  }

  async saveFile(request: SaveFileRequest): Promise<string | undefined> {
    const uri = await vscode.window.showSaveDialog({
      filters: { [request.filterLabel]: [request.extension] },
      defaultUri: vscode.Uri.file(request.suggestedName),
    });
    if (!uri) return undefined;
    await vscode.workspace.fs.writeFile(uri, request.data);
    return uri.fsPath;
  }

  showInfo(message: string): void {
    void vscode.window.showInformationMessage(message);
  }

  readFavorites(): Favorite[] {
    return this.globalState.get<Favorite[]>(VsCodeHost.favoritesKey, []);
  }

  async writeFavorites(list: Favorite[]): Promise<void> {
    await this.globalState.update(VsCodeHost.favoritesKey, list);
  }

  async promptForText(request: PromptRequest): Promise<string | undefined> {
    return await vscode.window.showInputBox({
      prompt: request.message,
      value: request.defaultValue,
      validateInput: (v) => (v.trim() ? null : "Enter a name."),
    });
  }
}

class ExplorerPanel {
  private static current: ExplorerPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly session: ExplorerSession;

  static show(extensionUri: vscode.Uri, globalState: vscode.Memento): void {
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
    ExplorerPanel.current = new ExplorerPanel(panel, extensionUri, globalState);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    globalState: vscode.Memento,
  ) {
    this.session = new ExplorerSession(new VsCodeHost(panel, globalState));
    this.panel.webview.html = this.getHtml(this.panel.webview, extensionUri);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: InboundMessage) => void this.session.dispatch(msg),
      null,
      this.disposables,
    );
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
    this.session.disposeSession();
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
