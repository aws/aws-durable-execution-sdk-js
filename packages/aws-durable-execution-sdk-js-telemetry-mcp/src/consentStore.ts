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
import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
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
      const dir = dirname(file);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      // Refuse a symlinked directory, and tighten one that already existed
      // with looser permissions; mkdir changes neither.
      const info = await lstat(dir);
      if (!info.isDirectory()) {
        throw new Error(`${dir} is not a directory; not saving the answer.`);
      }
      if ((info.mode & 0o077) !== 0) await chmod(dir, 0o700);
      // Several sessions can save at once. Without a lock each reads the file,
      // adds its key, and renames its copy over the others, so the last one
      // wins and the rest lose their answers.
      await withLock(`${file}.lock`, async () => {
        const data = await read();
        data.accepted = [
          ...data.accepted.filter((e) => e.key !== key),
          { key, acceptedAt: new Date().toISOString() },
        ].slice(-MAX_ENTRIES);
        // Write then rename, so a crash cannot leave a half-written file. The
        // temp name is random and opened with "wx", so a file or symlink planted
        // at a predictable path cannot redirect the write.
        const tmp = `${file}.${randomBytes(8).toString("hex")}.tmp`;
        try {
          await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, {
            mode: 0o600,
            flag: "wx",
          });
          await rename(tmp, file);
        } catch (err) {
          await unlink(tmp).catch(() => {});
          throw err;
        }
      });
    },
  };
}

/** How long to wait for another session's lock before giving up. */
const LOCK_WAIT_MS = 2000;
/** A lock older than this was left by a session that died; it is removed. */
const STALE_LOCK_MS = 10_000;

/**
 * Runs `fn` while holding `lockPath`, a file created with "wx" so only one
 * session can hold it. Waits up to LOCK_WAIT_MS for another holder, and
 * removes a lock file older than STALE_LOCK_MS.
 *
 * Every pass checks the deadline, so the wait always ends. A lock path that is
 * not a regular file, such as a directory or a symlink, was not made by this
 * code. So it is reported at once instead of being removed or waited on.
 */
async function withLock(
  lockPath: string,
  fn: () => Promise<void>,
): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.close();
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // lstat, not stat: a symlink is judged as itself, not by its target.
      const info = await lstat(lockPath).catch(() => undefined);
      if (info && !info.isFile()) {
        throw new Error(`${lockPath} is not a regular file; remove it`);
      }
      // An unlink that fails falls through to the deadline and the wait.
      const stale = info && Date.now() - info.mtimeMs > STALE_LOCK_MS;
      const removed =
        stale &&
        (await unlink(lockPath).then(
          () => true,
          () => false,
        ));
      if (removed) continue;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${lockPath}`);
      }
      await new Promise((r) => setTimeout(r, 10 + Math.random() * 20));
    }
  }
  try {
    await fn();
  } finally {
    await unlink(lockPath).catch(() => {});
  }
}
