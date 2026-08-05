/**
 * {@link HostPort} implemented against Electron.
 *
 * This is the desktop counterpart to the extension's `VsCodeHost`. Note what is
 * *not* here: no query logic, no agent loop, no drill-down handling. All of that
 * lives in the shared `ExplorerSession`, and this file only supplies the four
 * things a host has to provide — a channel to the renderer, a settings store, a
 * save dialog, and a way to say something worked.
 */
import { BrowserWindow, dialog } from "electron";
import { writeFile } from "node:fs/promises";
import type { InsightConfig } from "../../aws-durable-execution-sdk-js-insight-vscode/src/configCore";
import type {
  Favorite,
  HostPort,
  SaveFileRequest,
  SettingValue,
} from "../../aws-durable-execution-sdk-js-insight-vscode/src/hostPort";
import {
  readDesktopConfig,
  readDesktopFavorites,
  writeDesktopFavorites,
  writeDesktopSettings,
} from "./settings";

/** The IPC channel carrying host→renderer messages. Mirrored in preload.ts. */
export const TO_RENDERER_CHANNEL = "insight:toRenderer";

export class ElectronHost implements HostPort {
  constructor(private readonly window: BrowserWindow) {}

  post(message: Record<string, unknown>): void {
    // The window can be gone while an async handler is still finishing (the
    // user closed it mid-query); dropping the message is the correct response.
    if (this.window.isDestroyed()) return;
    this.window.webContents.send(TO_RENDERER_CHANNEL, message);
  }

  readConfig(): InsightConfig {
    return readDesktopConfig();
  }

  async writeSettings(values: Record<string, SettingValue>): Promise<void> {
    writeDesktopSettings(values);
  }

  async saveFile(request: SaveFileRequest): Promise<string | undefined> {
    const { canceled, filePath } = await dialog.showSaveDialog(this.window, {
      defaultPath: request.suggestedName,
      filters: [{ name: request.filterLabel, extensions: [request.extension] }],
    });
    if (canceled || !filePath) return undefined;
    await writeFile(filePath, request.data);
    return filePath;
  }

  showInfo(message: string): void {
    // The renderer already renders `status` text, so an informational message
    // surfaces in the same place it does in VS Code's webview rather than
    // interrupting with a modal dialog.
    this.post({ type: "status", text: message });
  }

  readFavorites(): Favorite[] {
    return readDesktopFavorites();
  }

  async writeFavorites(list: Favorite[]): Promise<void> {
    writeDesktopFavorites(list);
  }

  // promptForText is intentionally not implemented: Electron has no native
  // single-line input dialog, and spawning a second BrowserWindow to ask for a
  // name is not worth the surface. The session falls back to the label it would
  // have pre-filled, so saving a query works — it just isn't named
  // interactively. See the README's "Differences from the VS Code extension".
}
