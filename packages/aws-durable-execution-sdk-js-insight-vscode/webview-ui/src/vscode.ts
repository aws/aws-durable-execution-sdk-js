import type { OutboundMessage } from "./types";

interface VsCodeApi {
  postMessage(msg: OutboundMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

/**
 * A standalone-host bridge (e.g. the Electron desktop app) injects
 * `window.__insightHost` from its preload script. It mirrors the tiny slice of
 * the VS Code webview API we use: `post` sends a message to the host, and the
 * host delivers inbound messages as normal `window` `message` events (so every
 * existing `window.addEventListener("message")` consumer works unchanged).
 */
interface InsightHostBridge {
  post(msg: OutboundMessage): void;
  getState?(): unknown;
  setState?(state: unknown): void;
}

// acquireVsCodeApi is injected by the VS Code webview runtime; absent elsewhere.
declare function acquireVsCodeApi(): VsCodeApi;

const bridge: InsightHostBridge | undefined = (
  globalThis as { __insightHost?: InsightHostBridge }
).__insightHost;

// In VS Code we acquire the webview API once; in a standalone host we use the
// injected bridge and fall back to localStorage for view state.
const vscode: VsCodeApi | undefined =
  !bridge && typeof acquireVsCodeApi === "function"
    ? acquireVsCodeApi()
    : undefined;

export function postMessage(msg: OutboundMessage): void {
  if (bridge) bridge.post(msg);
  else vscode?.postMessage(msg);
}

export function getState(): unknown {
  if (vscode) return vscode.getState();
  if (bridge?.getState) return bridge.getState();
  try {
    const raw = globalThis.localStorage?.getItem("insight.state");
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function setState(state: unknown): void {
  if (vscode) {
    vscode.setState(state);
    return;
  }
  if (bridge?.setState) {
    bridge.setState(state);
    return;
  }
  try {
    globalThis.localStorage?.setItem("insight.state", JSON.stringify(state));
  } catch {
    /* ignore */
  }
}
