/**
 * The renderer's bridge into the host process.
 *
 * Runs with `contextIsolation` on and `sandbox` on, so this is the only code
 * that can see both `ipcRenderer` and the page. It exposes exactly two
 * capabilities and nothing else — no `require`, no filesystem, no arbitrary
 * channel access:
 *
 *   window.telemetryHost.postMessage(msg)   renderer -> host
 *   host messages re-dispatched as ordinary window "message" events
 *
 * The second half is what lets the shared React bundle stay host-agnostic: in
 * VS Code it receives host messages as `window` "message" events, so the desktop
 * app delivers them the same way instead of inventing a second inbound API.
 */
import { contextBridge, ipcRenderer } from "electron";

/** Mirrors TO_RENDERER_CHANNEL / FROM_RENDERER_CHANNEL in the host process. */
const TO_RENDERER_CHANNEL = "telemetry:toRenderer";
const FROM_RENDERER_CHANNEL = "telemetry:toHost";

contextBridge.exposeInMainWorld("telemetryHost", {
  postMessage: (msg: unknown): void => {
    ipcRenderer.send(FROM_RENDERER_CHANNEL, msg);
  },
});

ipcRenderer.on(TO_RENDERER_CHANNEL, (_event, message: unknown) => {
  // Target the concrete origin rather than "*": the page is loaded from the
  // telemetry:// scheme, so there is a real origin to name and no reason to
  // broadcast to any listener that might be embedded.
  window.postMessage(message, window.location.origin);
});
