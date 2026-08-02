/**
 * Preload bridge. Exposes `window.__insightHost.post` (used by the webview's
 * environment-aware `vscode.ts`) to send messages to the host, and re-emits
 * inbound host messages as ordinary `window` `message` events so every existing
 * `window.addEventListener("message")` consumer in the webview works unchanged.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("__insightHost", {
  post: (msg: unknown) => ipcRenderer.send("insight:toHost", msg),
});

ipcRenderer.on("insight:toWebview", (_event, msg) => {
  // Targeted at this window's own origin rather than "*", so host replies can't
  // be read by any other context that ends up holding a reference to it.
  window.postMessage(msg, window.location.origin);
});
