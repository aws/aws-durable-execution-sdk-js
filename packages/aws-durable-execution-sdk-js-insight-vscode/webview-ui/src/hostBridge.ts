import type { OutboundMessage } from "./types";

/**
 * The renderer's outbound channel, resolved once at load time.
 *
 * The same React bundle runs in two places, so it cannot assume either host:
 *
 *  - In VS Code, the webview runtime injects `acquireVsCodeApi()`.
 *  - In the desktop app, the Electron preload script exposes an equivalent on
 *    `window.insightHost` via `contextBridge`.
 *
 * Inbound messages need no abstraction: both hosts deliver them as ordinary
 * `window` "message" events, which is why components can keep using
 * `window.addEventListener("message", ...)` directly.
 */
interface HostApi {
  postMessage(msg: OutboundMessage): void;
}

// Injected by the VS Code webview runtime; absent in the desktop app.
declare function acquireVsCodeApi(): HostApi;

declare global {
  interface Window {
    /** Exposed by the desktop app's preload script; absent inside VS Code. */
    insightHost?: HostApi;
  }
}

function resolveHost(): HostApi {
  if (typeof acquireVsCodeApi === "function") {
    return acquireVsCodeApi();
  }
  if (window.insightHost) {
    return window.insightHost;
  }
  // Neither bridge is present, which means the bundle is running somewhere it
  // was never wired up. Fail loudly rather than dropping every user action.
  throw new Error(
    "No Workflow Insight host bridge found: expected the VS Code webview API or the desktop preload bridge.",
  );
}

const host = resolveHost();

export function postMessage(msg: OutboundMessage): void {
  host.postMessage(msg);
}
