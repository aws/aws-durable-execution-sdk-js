/**
 * The desktop app's entry point.
 *
 * Responsibilities, all of them host plumbing:
 *   - serve the extension's built webview bundle over a private `insight://`
 *     scheme, with a freshly-nonced CSP per load
 *   - create the window with the renderer fully de-privileged
 *   - relay renderer messages to the shared ExplorerSession, rejecting anything
 *     that did not come from the window's own main frame
 *
 * The UI and every behavior behind it come from
 * aws-durable-execution-sdk-js-insight-vscode; this file adds no features.
 */
import { app, BrowserWindow, ipcMain, protocol, shell } from "electron";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  ExplorerSession,
  type InboundMessage,
} from "@aws/durable-insight-core";
import { contentTypeFor, resolveAssetPath } from "./assetPath";
import { ElectronHost } from "./host";

/** Private scheme for app assets. Nothing remote is ever loaded. */
const SCHEME = "insight";
/** The single authority under our scheme, so origins are stable and nameable. */
const HOST = "app";
const APP_ORIGIN = `${SCHEME}://${HOST}`;
/** Mirrors FROM_RENDERER_CHANNEL in preload.ts. */
const FROM_RENDERER_CHANNEL = "insight:toHost";

/**
 * Treat `insight://` as a standard, secure origin.
 *
 * Without this the scheme is opaque: `window.location.origin` is null, the page
 * counts as insecure, and `postMessage` targeting a real origin (see preload.ts)
 * would never be delivered. Must run before `app.whenReady`.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

/**
 * Where the built webview bundle lives.
 *
 * Packaged, it is copied in as an `extraResources` entry. In a dev checkout it
 * is the sibling extension package's `media/`, which `npm run build` there
 * produces — the desktop app never builds the UI itself, so the two hosts cannot
 * be running different renderers.
 */
function mediaRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "media")
    : resolve(
        __dirname,
        "..",
        "..",
        "aws-durable-execution-sdk-js-insight-vscode",
        "media",
      );
}

function indexHtml(nonce: string): string {
  // Same CSP shape as the extension's webview, minus VS Code's asset host:
  // scripts run only with this load's nonce, and `default-src 'none'` means
  // nothing else — no remote fetch, no inline script — is reachable.
  //
  // `data:` is required in font-src because Cloudscape's stylesheet inlines its
  // icon font as a data URL; without it the fonts are refused and the UI renders
  // with fallback glyphs (confirmed by the renderer's CSP console warnings).
  const csp = [
    `default-src 'none'`,
    `style-src ${APP_ORIGIN} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${APP_ORIGIN} data:`,
    `img-src ${APP_ORIGIN} data: blob:`,
    `connect-src data: blob:`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${APP_ORIGIN}/webview.css" rel="stylesheet" />
  <title>Workflow Insight Explorer</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${APP_ORIGIN}/webview.js"></script>
</body>
</html>`;
}

/**
 * Serve one asset from {@link mediaRoot}.
 *
 * Path resolution and the traversal guard live in assetPath.ts so they can be
 * tested without an Electron runtime; see assetPath.test.ts.
 */
async function serveAsset(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // Only our single authority is served. `insight://evil/webview.js` is a
  // distinct origin that the CSP and the preload's targeted postMessage do not
  // account for, so refuse it rather than serving the app under a second origin.
  if (url.host !== HOST) {
    return new Response("Not found", { status: 404 });
  }
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/" || pathname === "/index.html") {
    return new Response(indexHtml(randomBytes(16).toString("base64")), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const path = resolveAssetPath(mediaRoot(), pathname);
  if (!path) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!existsSync(path)) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(await readFile(path), {
    status: 200,
    headers: { "content-type": contentTypeFor(path) },
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Workflow Insight Explorer",
    backgroundColor: "#1e1e1e",
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      // The renderer runs untrusted-by-default: no Node, an isolated context,
      // and the OS sandbox on. Everything privileged goes through the preload
      // bridge's two functions.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  window.once("ready-to-show", () => window.show());

  // Nothing in this app should ever navigate or open a second window. Deny both
  // and hand genuine external links to the OS browser instead.
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== `${APP_ORIGIN}/`) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  void window.loadURL(`${APP_ORIGIN}/`);
  return window;
}

/**
 * Create a window and wire a fresh {@link ExplorerSession} to it.
 *
 * One session per window, torn down with it, so a closed window cannot leave an
 * SQS tail running. The IPC listener is scoped to this window's `webContents`
 * and removed on close, which is what keeps a second window (macOS `activate`)
 * from being driven by the previous one's listener.
 */
function launch(): void {
  const window = createWindow();
  const session = new ExplorerSession(new ElectronHost(window));

  const onMessage = (
    event: Electron.IpcMainEvent,
    message: InboundMessage,
  ): void => {
    // Only this window's own top-level frame may drive the session. Without the
    // check, an embedded frame could reach AWS and the filesystem via the bridge.
    if (event.sender !== window.webContents) return;
    if (event.senderFrame !== window.webContents.mainFrame) return;
    if (!message || typeof message !== "object") return;
    void session.dispatch(message);
  };

  ipcMain.on(FROM_RENDERER_CHANNEL, onMessage);
  window.on("closed", () => {
    ipcMain.removeListener(FROM_RENDERER_CHANNEL, onMessage);
    session.disposeSession();
  });
}

app
  .whenReady()
  .then(() => {
    protocol.handle(SCHEME, serveAsset);
    launch();
  })
  .catch((err: unknown) => {
    // Nothing has a window yet, so there is no UI to report into: fail loudly
    // and exit rather than leaving a running process with no way in. Without the
    // catch this would surface only as an unhandled rejection warning.
    console.error("[workflow-insight] failed to start:", err);
    app.exit(1);
  });

// Standard single-window desktop behavior: quit with the last window, except on
// macOS where the app is expected to stay resident in the dock.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) launch();
});
