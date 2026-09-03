import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SerdesContext, AnySerdes } from "./serdes";
import { CHECKPOINT_SIZE_LIMIT_BYTES } from "../constants/constants";
export {
  FieldMatchMode,
  PreviewMode,
  PreviewField,
  PreviewConfig,
  buildPreview,
} from "./preview";

// Subtract 1KB headroom for the envelope wrapper and other checkpoint metadata
const OVERFLOW_THRESHOLD_BYTES = CHECKPOINT_SIZE_LIMIT_BYTES - 1024;

/**
 * Controls when data is written to the filesystem.
 *
 * - `ALWAYS`: Every value is written to a file; the checkpoint stores only a file pointer.
 *   Best for consistently large payloads or when you want predictable checkpoint sizes.
 *
 * - `OVERFLOW`: Data is written inline (as JSON) unless it exceeds the durable function
 *   checkpoint size limit (~256KB), in which case it overflows to a file.
 *   Best for mixed workloads where most payloads are small.
 *
 * @public
 */
export enum FileSystemSerdesMode {
  ALWAYS = "ALWAYS",
  OVERFLOW = "OVERFLOW",
}

/**
 * Controls how the durable execution ARN and entity ID are turned into the
 * on-disk directory and file names.
 *
 * - `URI`: The per-execution directory is a compact, human-navigable path built
 *   from the ARN's function name, execution name and invocation id
 *   (`<functionName>/<executionName>/<invocationId>`); the file name is the
 *   entity ID encoded with `encodeURIComponent`. Names stay readable, but a very
 *   long entity ID may exceed the filesystem's per-name length limit (commonly
 *   255 bytes). If the ARN does not match the expected durable-execution shape,
 *   the whole ARN is `encodeURIComponent`-encoded into a single directory
 *   segment instead.
 *
 * - `HASH`: The ARN (directory) and entity ID (file name) are each replaced by
 *   their SHA-256 hex digest. Names are a fixed length (64 chars) and always
 *   filesystem-safe regardless of the characters or length of the original
 *   value, at the cost of no longer being human-readable when browsing the
 *   mount.
 *
 * @public
 */
export enum FileSystemPathEncoding {
  URI = "URI",
  HASH = "HASH",
}

/**
 * Configuration options for {@link createFileSystemSerdes}.
 *
 * @public
 */
export interface FileSystemSerdesConfig {
  /**
   * Controls when data is written to the filesystem.
   * @defaultValue `FileSystemSerdesMode.ALWAYS`
   */
  storageMode?: FileSystemSerdesMode;
  /**
   * Controls how the durable execution ARN (directory) and entity ID (file
   * name) are encoded into path segments.
   *
   * Use `FileSystemPathEncoding.HASH` when entity IDs may contain characters
   * that are unsafe in a file name (for example `/`) or may be long enough to
   * exceed the filesystem's name-length limit.
   *
   * @defaultValue `FileSystemPathEncoding.URI`
   */
  pathEncoding?: FileSystemPathEncoding;
  /**
   * Optional function that generates a preview object from the value.
   * When provided, the preview is stored inline in the checkpoint envelope
   * alongside the file pointer, making data visible in the console and API
   * without reading the full file.
   *
   * Use {@link buildPreview} with a {@link PreviewConfig} for the built-in
   * field selection logic, or provide your own implementation.
   *
   * @example
   * ```typescript
   * // Using the built-in buildPreview helper
   * createFileSystemSerdes("/mnt/s3", {
   *   generatePreview: (value) => buildPreview(value, {
   *     mode: PreviewMode.EXCLUDE_ALL,
   *     include: [{ name: "id" }, { name: "status" }],
   *     mask: [{ name: "email" }],
   *   }),
   * });
   *
   * // Custom implementation
   * createFileSystemSerdes("/mnt/s3", {
   *   generatePreview: (value) => ({
   *     id: (value as any).id,
   *     summary: `Order ${(value as any).id}`,
   *   }),
   * });
   * ```
   */
  generatePreview?: (value: unknown) => Record<string, unknown> | undefined;
}

/** @internal */
type FileSystemEnvelope =
  | { data: string }
  | { file: string; preview?: Record<string, unknown> };

/**
 * Encodes a path segment (the execution ARN or entity ID) into a name that is
 * safe to use on the filesystem.
 *
 * @internal
 */
function encodeSegment(
  value: string,
  encoding: FileSystemPathEncoding,
): string {
  return encoding === FileSystemPathEncoding.HASH
    ? createHash("sha256").update(value).digest("hex")
    : encodeURIComponent(value);
}

/**
 * The parts of a durable execution ARN that identify a single execution.
 *
 * These values are stable for the lifetime of an execution — they do not
 * change across the multiple Lambda invocations (replays) of that execution —
 * and are already filesystem-safe (function name charset plus UUIDs).
 *
 * @internal
 */
interface DurableExecutionArnParts {
  functionName: string;
  executionName: string;
  invocationId: string;
}

/**
 * Matches a durable execution ARN of the form:
 *
 *   arn:<partition>:lambda:<region>:<account>:function:<functionName>:<version>/durable-execution/<executionName>/<invocationId>
 *
 * @internal
 */
const DURABLE_EXECUTION_ARN_PATTERN =
  /^arn:[^:]*:lambda:[^:]*:[^:]*:function:([^:/]+):[^:/]+\/durable-execution\/([^/]+)\/([^/]+)$/;

/** @internal */
function parseDurableExecutionArn(
  arn: string,
): DurableExecutionArnParts | undefined {
  const match = DURABLE_EXECUTION_ARN_PATTERN.exec(arn);
  if (!match) return undefined;
  return {
    functionName: match[1],
    executionName: match[2],
    invocationId: match[3],
  };
}

/**
 * Resolves the per-execution directory under `basePath`.
 *
 * In `URI` mode the directory is a compact, human-navigable path built from the
 * execution's function name, execution name and invocation id (all stable for
 * the lifetime of the execution and already filesystem-safe). If the ARN does
 * not match the expected shape (for example a local/test ARN), the whole ARN is
 * URI-encoded into a single segment instead.
 *
 * In `HASH` mode the whole ARN is hashed into a single fixed-length segment.
 *
 * @internal
 */
function resolveExecutionDir(
  basePath: string,
  arn: string,
  pathEncoding: FileSystemPathEncoding,
): string {
  if (pathEncoding === FileSystemPathEncoding.URI) {
    const parts = parseDurableExecutionArn(arn);
    if (parts) {
      return join(
        basePath,
        parts.functionName,
        parts.executionName,
        parts.invocationId,
      );
    }
  }
  return join(basePath, encodeSegment(arn, pathEncoding));
}

async function writeToFile(
  basePath: string,
  value: any,
  context: SerdesContext,
  pathEncoding: FileSystemPathEncoding,
): Promise<string> {
  const dir = resolveExecutionDir(
    basePath,
    context.durableExecutionArn,
    pathEncoding,
  );
  await mkdir(dir, { recursive: true });
  const filePath = join(
    dir,
    `${encodeSegment(context.entityId, pathEncoding)}.json`,
  );
  await writeFile(filePath, JSON.stringify(value), "utf-8");
  return filePath;
}

/**
 * Creates a Serdes that stores serialized values on a durable filesystem.
 *
 * **⚠️ WARNING: Do NOT use with Lambda's ephemeral `/tmp` storage.**
 * Lambda's `/tmp` filesystem is local to a single execution environment and is
 * not shared across invocations or function instances. On replay, a different
 * execution environment may be used and the file will not be found, causing
 * deserialization to fail.
 *
 * **Use only with a durable, shared filesystem such as:**
 * - **Amazon S3 Files** — mount an S3 bucket as a filesystem via the Lambda console or IaC
 * - **Amazon EFS** — mount an EFS file system to your Lambda function
 *
 * Both options provide persistence across invocations and are accessible from
 * multiple concurrent function instances, which is required for correct replay behavior.
 *
 * The checkpoint stores a JSON envelope that is either:
 * - `{"data":"<inline JSON>"}` — value stored inline (OVERFLOW mode, under threshold)
 * - `{"file":"<path>"}` — value stored in a file
 * - `{"file":"<path>","preview":{...}}` — file pointer with inline preview (when preview is configured)
 *
 * @param basePath - Directory path where data files will be stored (e.g. `/mnt/s3` for S3 Files, `/mnt/efs` for EFS)
 * @param config - Optional configuration options
 * @returns A Serdes that reads/writes JSON files under basePath
 *
 * @example
 * ```typescript
 * // Always write to S3 Files mount (default)
 * context.configureSerdes({
 *   defaultSerdes: createFileSystemSerdes("/mnt/s3"),
 * });
 *
 * // Only overflow to filesystem when payload exceeds ~256KB
 * context.configureSerdes({
 *   defaultSerdes: createFileSystemSerdes("/mnt/s3", { storageMode: FileSystemSerdesMode.OVERFLOW }),
 * });
 *
 * // With preview: show id and masked email in checkpoint
 * context.configureSerdes({
 *   defaultSerdes: createFileSystemSerdes("/mnt/s3", {
 *     generatePreview: (value) => buildPreview(value, {
 *       mode: PreviewMode.EXCLUDE_ALL,
 *       include: [{ name: "id" }, { name: "status" }],
 *       mask: [{ name: "email" }],
 *     }),
 *   }),
 * });
 * ```
 *
 * Limitations:
 * - Field names containing dots are not supported in preview field selectors.
 *   A dot in a field name is indistinguishable from a path separator.
 * - Array structure is not preserved in preview output — fields from array
 *   elements are merged into a plain object at the array's path.
 *
 * @public
 */
export function createFileSystemSerdes(
  basePath: string,
  config: FileSystemSerdesConfig = {},
): AnySerdes {
  const storageMode = config.storageMode ?? FileSystemSerdesMode.ALWAYS;
  const pathEncoding = config.pathEncoding ?? FileSystemPathEncoding.URI;
  return {
    serialize: async (
      value: any,
      context: SerdesContext,
    ): Promise<string | undefined> => {
      if (value === undefined) return undefined;

      if (storageMode === FileSystemSerdesMode.ALWAYS) {
        const filePath = await writeToFile(
          basePath,
          value,
          context,
          pathEncoding,
        );
        const preview = config.generatePreview?.(value);
        const envelope: FileSystemEnvelope = preview
          ? { file: filePath, preview }
          : { file: filePath };
        return JSON.stringify(envelope);
      }

      // OVERFLOW mode: serialize inline first, overflow to file if too large
      const inlineJson = JSON.stringify(value);
      const envelope = JSON.stringify({
        data: inlineJson,
      } as FileSystemEnvelope);
      if (Buffer.byteLength(envelope, "utf-8") > OVERFLOW_THRESHOLD_BYTES) {
        const filePath = await writeToFile(
          basePath,
          value,
          context,
          pathEncoding,
        );
        const preview = config.generatePreview?.(value);
        const fileEnvelope: FileSystemEnvelope = preview
          ? { file: filePath, preview }
          : { file: filePath };
        return JSON.stringify(fileEnvelope);
      }
      return envelope;
    },

    deserialize: async (
      data: string | undefined,
      _context: SerdesContext,
    ): Promise<any> => {
      if (data === undefined) return undefined;

      const envelope = JSON.parse(data) as FileSystemEnvelope;

      if ("file" in envelope) {
        const contents = await readFile(envelope.file, "utf-8");
        return JSON.parse(contents);
      }

      return JSON.parse(envelope.data);
    },
  };
}
