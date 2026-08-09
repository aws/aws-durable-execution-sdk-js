/**
 * The contract between Workflow Insight's logic and whatever is hosting it.
 *
 * Everything the Explorer does that is not pure computation — persisting a
 * setting, showing a save dialog, telling the user something, pushing a message
 * at the renderer — arrives through this port. `explorerSession.ts` is written
 * against it and therefore contains no host-specific code, which is what lets
 * the VS Code extension and the Electron desktop app run the *same* query,
 * agent, and drill-down logic instead of two copies that drift.
 *
 * Adapters: `extension.ts` (VS Code) and the desktop package's `host.ts`.
 */
import type { InsightConfig } from "./configCore";

/**
 * A settings value as the host should persist it. `undefined` means "unset",
 * so the host's own schema default applies — distinct from the empty string.
 */
export type SettingValue = string | boolean | number | undefined;

/** A saved query (kept in sync with Favorite in webview-ui/src/types.ts). */
export interface Favorite {
  id: string;
  label: string;
  query: string;
  destinationType: string;
}

export interface SaveFileRequest {
  /** Pre-filled filename, e.g. `chart.svg`. */
  suggestedName: string;
  /** Extension without the dot, for the dialog's file-type filter. */
  extension: string;
  /** Human-readable filter label, e.g. `SVG`. */
  filterLabel: string;
  /** Bytes to write once the user picks a location. */
  data: Buffer;
}

export interface PromptRequest {
  message: string;
  defaultValue: string;
}

export interface HostPort {
  /** Push a message to the renderer (webview or Electron window). */
  post(message: Record<string, unknown>): void;

  /** The user's persisted settings, normalized by configCore. */
  readConfig(): InsightConfig;

  /**
   * Persist these settings keys. Values are already coerced to their schema
   * types by the caller, so a host only has to store them.
   */
  writeSettings(values: Record<string, SettingValue>): Promise<void>;

  /**
   * Show a save dialog and write `data` to the chosen path. Resolves to the
   * path written, or undefined if the user cancelled.
   */
  saveFile(request: SaveFileRequest): Promise<string | undefined>;

  /** Tell the user something succeeded (a toast, or the host's equivalent). */
  showInfo(message: string): void;

  /** Saved queries. Synchronous read; hosts keep them in memory. */
  readFavorites(): Favorite[];
  writeFavorites(list: Favorite[]): Promise<void>;

  /**
   * Ask the user for a line of text, resolving to undefined if they cancel.
   *
   * Optional: a host with no native text prompt may omit it, in which case the
   * session falls back to the value it would have pre-filled. That is why
   * naming a saved query is interactive in VS Code (`showInputBox`) but
   * automatic in the desktop app.
   */
  promptForText?(request: PromptRequest): Promise<string | undefined>;
}
