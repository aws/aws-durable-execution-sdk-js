/**
 * Remembers "don't ask again" answers to the credential prompt
 * (writeAccessGate.ts) across sessions.
 *
 * WHAT IS REMEMBERED. A hash of the destination configuration: destination
 * type, region, profile, and every destination setting (table, cluster ARN,
 * secret ARN, and so on). Changing any of them — a different table, a
 * different secret, a different profile — produces a different key, so the
 * server asks again. Nothing from the configuration is stored in plain text.
 *
 * WHERE. One JSON file under the user's home directory, created with mode
 * 0600. Deleting it makes the server ask again everywhere. Like the
 * environment variable it stands in for, it is the user's own file: an agent
 * with shell access could write it too, which is no different from it editing
 * the server's config to set the variable.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { TelemetryConfig } from "@aws/durable-execution-sdk-js-telemetry-core";
import { MCP_EXCLUDED_SETTING_KEYS } from "./envKeys";

/** Default location of the remembered answers. */
export function defaultConsentFile(): string {
  return join(homedir(), ".durable-telemetry", "accepted-credentials.json");
}

interface ConsentFile {
  version: 1;
  accepted: { key: string; acceptedAt: string }[];
}

/** Most entries kept; the oldest are dropped first. */
const MAX_ENTRIES = 200;

/**
 * The key for a configuration: a SHA-256 of every destination-identifying
 * setting, in a fixed order. LLM settings are left out because this host
 * ignores them, so they must not make the server ask again.
 */
export function consentKey(cfg: TelemetryConfig): string {
  const excluded = new Set(MCP_EXCLUDED_SETTING_KEYS);
  const entries = Object.entries(cfg)
    .filter(([k]) => !excluded.has(k))
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

export interface ConsentStore {
  has(key: string): Promise<boolean>;
  add(key: string): Promise<void>;
}

/** A store backed by `file`. A missing or unreadable file means "not remembered". */
export function fileConsentStore(file = defaultConsentFile()): ConsentStore {
  const read = async (): Promise<ConsentFile> => {
    try {
      const parsed = JSON.parse(await readFile(file, "utf-8")) as ConsentFile;
      if (parsed?.version === 1 && Array.isArray(parsed.accepted)) {
        return parsed;
      }
    } catch {
      // Missing or corrupt: ask again rather than fail the tool call.
    }
    return { version: 1, accepted: [] };
  };
  return {
    async has(key) {
      return (await read()).accepted.some((e) => e.key === key);
    },
    async add(key) {
      const data = await read();
      data.accepted = [
        ...data.accepted.filter((e) => e.key !== key),
        { key, acceptedAt: new Date().toISOString() },
      ].slice(-MAX_ENTRIES);
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      // Write then rename, so a crash cannot leave a half-written file.
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, {
        mode: 0o600,
      });
      await rename(tmp, file);
    },
  };
}
