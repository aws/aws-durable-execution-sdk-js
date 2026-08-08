/**
 * The desktop app's persistence: the counterpart to VS Code's settings store
 * and `globalState`.
 *
 * Two JSON files under Electron's per-user data directory, mirroring the two
 * things the VS Code host keeps:
 *
 *   insight-settings.json   the `workflowInsight.*` settings
 *   insight-favorites.json  saved queries
 *
 * Settings are read back through configCore's `normalizeConfig`, so defaults,
 * clamping, and coercion are identical to the extension's — a value means the
 * same thing in both hosts because only one module decides what it means.
 */
import { app } from "electron";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  normalizeConfig,
  type InsightConfig,
  isSettingKey,
  type Favorite,
  type SettingValue,
} from "durable-insight-core";

/** What lands in insight-settings.json: recognized keys and scalar values. */
type StoredSettings = Record<string, string | number | boolean>;

function dataDir(): string {
  const dir = app.getPath("userData");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function settingsFile(): string {
  return join(dataDir(), "insight-settings.json");
}

function favoritesFile(): string {
  return join(dataDir(), "insight-favorites.json");
}

/**
 * Read and parse a JSON file, returning undefined for "missing" and for
 * "corrupt". A settings file someone hand-edited into invalid JSON should not
 * prevent the app from starting; falling back to defaults is recoverable,
 * refusing to launch is not.
 */
function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    console.warn(`[workflow-insight] ignoring unreadable ${path}`);
    return undefined;
  }
}

/**
 * Write via a temp file and rename, so a crash mid-write cannot leave a
 * truncated settings file behind (rename is atomic within a directory).
 */
function writeJson(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  try {
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // Nothing useful to do if even the cleanup fails.
    }
    throw err;
  }
}

/**
 * The stored settings, filtered to recognized keys.
 *
 * Filtering on read as well as on write matters: it makes an older or
 * hand-edited file containing unknown keys behave the same as one written by
 * this build, and keeps inherited names (`__proto__`, `constructor`) from ever
 * reaching the lookup below.
 */
function loadSettings(): StoredSettings {
  const raw = readJson<Record<string, unknown>>(settingsFile()) ?? {};
  const out: StoredSettings = Object.create(null) as StoredSettings;
  for (const [key, value] of Object.entries(raw)) {
    if (!isSettingKey(key)) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
    }
  }
  return out;
}

/** The current settings as an {@link InsightConfig}, normalized by configCore. */
export function readDesktopConfig(): InsightConfig {
  const stored = loadSettings();
  const get = (k: string): unknown =>
    Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : undefined;
  return normalizeConfig({
    getString: (k) => {
      const v = get(k);
      return v === undefined ? undefined : String(v);
    },
    getBool: (k) => {
      const v = get(k);
      if (v === undefined) return undefined;
      return typeof v === "boolean" ? v : v === "true";
    },
    getNumber: (k) => {
      const v = get(k);
      if (v === undefined) return undefined;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : undefined;
    },
  });
}

/**
 * Merge these keys into the stored settings.
 *
 * Deliberately a targeted merge of recognized keys rather than replacing the
 * file with the renderer's object: the renderer sends only the fields its
 * Settings modal knows about, so a wholesale write would silently drop
 * everything else. `undefined` means "unset" and removes the key so
 * configCore's default applies again.
 */
export function writeDesktopSettings(
  values: Record<string, SettingValue>,
): void {
  const merged = { ...loadSettings() };
  for (const [key, value] of Object.entries(values)) {
    if (!isSettingKey(key)) continue;
    if (value === undefined) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }
  writeJson(settingsFile(), merged);
}

export function readDesktopFavorites(): Favorite[] {
  const raw = readJson<unknown>(favoritesFile());
  if (!Array.isArray(raw)) return [];
  // Keep only well-formed entries so one bad record can't break the list.
  return raw.filter(
    (f): f is Favorite =>
      !!f &&
      typeof f === "object" &&
      typeof (f as Favorite).id === "string" &&
      typeof (f as Favorite).label === "string" &&
      typeof (f as Favorite).query === "string" &&
      typeof (f as Favorite).destinationType === "string",
  );
}

export function writeDesktopFavorites(list: Favorite[]): void {
  writeJson(favoritesFile(), list);
}
