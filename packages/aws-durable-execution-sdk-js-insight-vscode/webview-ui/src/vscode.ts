import type { OutboundMessage } from "./types";

interface VsCodeApi {
  postMessage(msg: OutboundMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

// acquireVsCodeApi is injected by the VS Code webview runtime
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

export function postMessage(msg: OutboundMessage): void {
  vscode.postMessage(msg);
}
