/**
 * A tiny JSON-file settings store in the app's userData dir — the standalone
 * equivalent of the VS Code `workspace.getConfiguration` + `Memento` state the
 * extension host uses. Keeps region/profile and the same setting keys the
 * webview expects in its `config` message.
 */
import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Settings = Record<string, string>;

const DEFAULTS: Settings = {
  region:
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  awsProfile: process.env.AWS_PROFILE || "",
  llmProvider: "bedrock",
  bedrockModelId: "anthropic.claude-3-5-sonnet-20240620-v1:0",
  agenticMaxIterations: "8",
  queryMode: "agent",
  aiDisclosureAcceptedVersion: "",
  dateFormat: "relative",
  dateVariant: "short",
};

function settingsPath(): string {
  return join(app.getPath("userData"), "insight-settings.json");
}

export function readSettings(): Settings {
  try {
    const raw = readFileSync(settingsPath(), "utf-8");
    return { ...DEFAULTS, ...(JSON.parse(raw) as Settings) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(patch: Settings): Settings {
  const merged = { ...readSettings(), ...patch };
  const p = settingsPath();
  mkdirSync(dirname(p), { recursive: true });
  // 0o600: this file carries the local LLM endpoint and the AWS profile name, so it
  // should not be world-readable on a shared machine.
  writeFileSync(p, JSON.stringify(merged, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  return merged;
}

/** Favorites (simple string list), persisted alongside settings. */
export function readFavorites(): string[] {
  try {
    const raw = readFileSync(
      join(app.getPath("userData"), "insight-favorites.json"),
      "utf-8",
    );
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export { existsSync };
