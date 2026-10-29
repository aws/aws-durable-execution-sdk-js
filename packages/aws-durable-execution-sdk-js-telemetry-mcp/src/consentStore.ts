/**
 * Remembers "Don't ask again" answers to the credential prompt
 * (writeAccessGate.ts) across sessions.
 *
 * WHAT IS REMEMBERED. A SHA-256 of the destination configuration: destination
 * type, region, profile, and every destination setting. A change to any of
 * them gives a different key. So the server asks again. No setting is stored
 * in plain text.
 *
 * WHERE. One empty file per key, named by the key, in a directory under the
 * user's home directory. Deleting the directory makes the server ask again.
 *
 * WHY ONE FILE PER KEY. Several sessions can save at once. With one shared
 * file, each session would read it, add its key and write it back. So one
 * write could drop another session's key. With one file per key, a save
 * writes only its own file. So no lock is needed.
 *
 * WHAT IT DOES NOT DEFEND AGAINST. A process that can write the user's home
 * directory can create a key file. The same process can also edit the client
 * config to set DURABLE_TELEMETRY_ACCEPT_WRITE_ACCESS. So the store adds no
 * route around the prompt, and it has no checks against such a process.
 */
import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TelemetryConfig } from "@aws/durable-execution-sdk-js-telemetry-core";
import { MCP_EXCLUDED_SETTING_KEYS } from "./envKeys";

/** Default location of the remembered answers. */
export function defaultConsentDir(): string {
  return join(homedir(), ".durable-telemetry", "accepted-credentials");
}

/**
 * The key for a configuration: a SHA-256 of every destination setting, in a
 * fixed order. LLM settings are left out because this host ignores them. So
 * a change to them does not make the server ask again.
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

/**
 * A store backed by the directory `dir`. A missing directory or key file means
 * "not remembered".
 */
export function fileConsentStore(dir = defaultConsentDir()): ConsentStore {
  return {
    async has(key) {
      return stat(join(dir, key)).then(
        () => true,
        () => false,
      );
    },
    async add(key) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      // The file is empty. So writing a remembered key again changes nothing.
      await writeFile(join(dir, key), "", { mode: 0o600 });
    },
  };
}
