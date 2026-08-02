/**
 * Electron main process for the standalone Workflow Insight app.
 *
 * It reuses the VS Code extension's built webview bundle (media/webview.js|css +
 * Monaco workers) as the renderer, served over a privileged `insight://` scheme,
 * and bridges the webview's message protocol to the desktop host over IPC. The
 * preload turns inbound host messages into ordinary `window` `message` events,
 * so every existing webview consumer works unchanged.
 */
import {
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
  protocol,
  shell,
} from "electron";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { handleMessage } from "./host";
import type { OutboundMessage } from "../../aws-durable-execution-sdk-js-insight-vscode/webview-ui/src/types";

// The extension's built webview assets (run `npm run build` in the extension's
// webview-ui first). Resolution order:
//  1. INSIGHT_MEDIA_DIR — explicit override, used in local dev.
//  2. Packaged layout — electron-builder copies it to `Resources/media` via
//     `extraResources` (see package.json's `build.extraResources`).
//  3. Monorepo dev layout — the sibling extension package, unpackaged.
const PACKAGED_MEDIA_DIR = join(
  (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? "",
  "media",
);
const DEV_MEDIA_DIR = join(
  __dirname,
  "..",
  "..",
  "aws-durable-execution-sdk-js-insight-vscode",
  "media",
);
const MEDIA_DIR =
  process.env.INSIGHT_MEDIA_DIR ||
  (app.isPackaged || existsSync(PACKAGED_MEDIA_DIR)
    ? PACKAGED_MEDIA_DIR
    : DEV_MEDIA_DIR);

/** App icon (dist/main.js lives one level below the package root). */
const ICON_PATH = join(__dirname, "..", "assets", "icon.png");

const SCHEME = "insight";
const ORIGIN = `${SCHEME}://app`;

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

function indexHtml(): string {
  // A fresh nonce per load, so the one inline script can be allowed without
  // `unsafe-inline` — which would also permit any script injected into the DOM.
  const nonce = randomBytes(16).toString("base64");
  const csp = [
    "default-src 'none'",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${nonce}' blob:`,
    "worker-src 'self' blob:",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    "connect-src 'self' data: blob:",
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${ORIGIN}/webview.css" rel="stylesheet" />
  <title>Workflow Insight</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">globalThis.__MONACO_WORKER_BASE__ = ${JSON.stringify(`${ORIGIN}/monaco`)};</script>
  <script nonce="${nonce}" src="${ORIGIN}/webview.js"></script>
</body>
</html>`;
}

async function serve(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = decodeURIComponent(url.pathname);
  if (path === "/" || path === "/index.html") {
    return new Response(indexHtml(), {
      headers: { "content-type": "text/html" },
    });
  }
  const ext = path.slice(path.lastIndexOf("."));
  // Contain the request inside MEDIA_DIR.
  //
  // Percent-encoded dot segments survive Chromium's URL normalization — `%2f`
  // isn't a separator, so `%2e%2e%2f` is not recognized as `../` and is only
  // turned into one by the decodeURIComponent above. Joining that straight onto
  // MEDIA_DIR escaped it (`/%2e%2e%2f%2e%2e%2fetc/passwd` resolved to
  // `/Users/etc/passwd`). Resolve first, then require the result to still be
  // under the root, which holds regardless of how the traversal was spelled.
  const resolvedRoot = resolve(MEDIA_DIR);
  const target = resolve(join(resolvedRoot, path));
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  try {
    const buf = await readFile(target);
    return new Response(new Uint8Array(buf), {
      headers: {
        "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Workflow Insight",
    // Window icon (Windows/Linux; macOS uses the dock icon set below).
    icon: ICON_PATH,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload only uses contextBridge + ipcRenderer, which both work in a
      // sandboxed renderer, so there is nothing to gain from leaving it off.
      sandbox: true,
    },
  });

  // Deny navigation and new windows outright: every route the UI needs is served
  // from the insight:// scheme, so anything else is either a bug or an attempt to
  // pull remote content into a renderer that holds an IPC bridge.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`) && url !== ORIGIN) event.preventDefault();
  });

  ipcMain.on("insight:toHost", (event, msg: OutboundMessage) => {
    // This channel reaches AWS calls, file writes and esbuild, so only accept it
    // from the app's own top-level frame — not from any subframe that managed to
    // load, and not after the window is gone.
    const frame = event.senderFrame;
    if (!frame || frame.parent !== null || !frame.url.startsWith(ORIGIN))
      return;
    void handleMessage(msg, (out) =>
      event.sender.send("insight:toWebview", out),
    );
  });

  void win.loadURL(`${ORIGIN}/index.html`);
}

void app.whenReady().then(() => {
  // Replace the generic Electron dock icon (the app runs unpackaged, so the
  // icon must be set at runtime; a packaged build would bake it in instead).
  if (process.platform === "darwin") {
    const img = nativeImage.createFromPath(ICON_PATH);
    if (!img.isEmpty()) app.dock?.setIcon(img);
  }
  protocol.handle(SCHEME, serve);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
