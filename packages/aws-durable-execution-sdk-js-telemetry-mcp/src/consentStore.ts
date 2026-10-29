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
 * WHERE. One empty file per remembered key, named by the key, in a directory
 * under the user's home directory. The directory has mode 0700 and each file
 * mode 0600. Deleting the directory makes the server ask again everywhere.
 * Like the environment variable it stands in for, it is the user's own
 * directory: an agent with shell access could write it too, which is no
 * different from it editing the server's config to set the variable.
 *
 * WHY ONE FILE PER KEY. Several sessions can save at once. With one shared
 * file, each would read it, add its key, and write it back, so one write
 * could drop another's key. That needs a lock, and a lock left by a crashed
 * session needs a takeover that two sessions can race. Creating a file is
 * atomic, and two saves never touch the same file. So no lock is needed, and
 * no save can drop another's answer.
 */
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { TelemetryConfig } from "@aws/durable-execution-sdk-js-telemetry-core";
import { MCP_EXCLUDED_SETTING_KEYS } from "./envKeys";

/** Default location of the remembered answers: a directory. */
export function defaultConsentDir(): string {
  return join(homedir(), ".durable-telemetry", "accepted-credentials");
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

/** A key is a SHA-256 in hex, so it is always a safe file name. */
const KEY_PATTERN = /^[0-9a-f]{64}$/;

/**
 * A store backed by the directory `dir`. A missing directory or key file means
 * "not remembered".
 */
export function fileConsentStore(dir = defaultConsentDir()): ConsentStore {
  const pathFor = (key: string): string => {
    if (!KEY_PATTERN.test(key)) throw new Error("Invalid consent key.");
    return join(dir, key);
  };
  return {
    async has(key) {
      // lstat, not stat: a symlink planted under a key's name does not count.
      const info = await lstat(pathFor(key)).catch(() => undefined);
      return info?.isFile() ?? false;
    },
    async add(key) {
      const path = pathFor(key);
      // Check each directory before creating the next, so nothing is created
      // through a symlinked parent. Refuse a symlinked directory, and tighten
      // one that already existed with looser permissions; mkdir changes
      // neither.
      await mkdir(dirname(dir), { recursive: true, mode: 0o700 });
      await checkDirectory(dirname(dir));
      await mkdir(dir, { mode: 0o700 }).catch((err) => {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      });
      await checkDirectory(dir);
      try {
        // "wx" creates the file or fails. It never writes through a symlink.
        await writeFile(path, "", { mode: 0o600, flag: "wx" });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        const info = await lstat(path);
        if (!info.isFile()) {
          throw new Error(`${path} is not a regular file; remove it.`);
        }
        // Already remembered.
        return;
      }
      await prune(dir);
    },
  };
}

async function checkDirectory(d: string): Promise<void> {
  const info = await lstat(d);
  if (!info.isDirectory()) {
    throw new Error(`${d} is not a directory; not saving the answer.`);
  }
  if ((info.mode & 0o077) !== 0) await chmod(d, 0o700);
}

/**
 * Removes the oldest key files beyond MAX_ENTRIES. Two sessions pruning at
 * once can remove one file too many. That only makes the server ask again for
 * one old configuration, so it is not worth a lock.
 */
async function prune(dir: string): Promise<void> {
  const names = (await readdir(dir)).filter((n) => KEY_PATTERN.test(n));
  if (names.length <= MAX_ENTRIES) return;
  const files: { path: string; mtimeMs: number }[] = [];
  for (const n of names) {
    const path = join(dir, n);
    const info = await lstat(path).catch(() => undefined);
    if (info?.isFile()) files.push({ path, mtimeMs: info.mtimeMs });
  }
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const f of files.slice(0, Math.max(0, files.length - MAX_ENTRIES))) {
    await unlink(f.path).catch(() => {});
  }
}
