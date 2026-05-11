import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SerdesContext, AnySerdes } from "./serdes";
import { CHECKPOINT_SIZE_LIMIT_BYTES } from "../constants/constants";

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
 * Controls whether a preview field is matched by name anywhere in the object
 * tree, or by exact dot-notation path from the root.
 *
 * @public
 */
export enum FieldMatchMode {
  /** Match the field name at any depth in the object tree (default). */
  ANYWHERE = "ANYWHERE",
  /**
   * Match by exact dot-notation path from root.
   * A single segment (e.g. `"email"`) matches only the root-level field.
   * A dotted path (e.g. `"user.email"`) matches that exact nested location.
   */
  PATH = "PATH",
}

/**
 * Controls which fields are included in the preview by default.
 *
 * @public
 */
export enum PreviewMode {
  /** Include all fields, then apply `exclude` and `mask` rules. */
  INCLUDE_ALL = "INCLUDE_ALL",
  /** Exclude all fields, then apply `include` and `mask` rules. */
  EXCLUDE_ALL = "EXCLUDE_ALL",
}

/**
 * A field selector used in preview include/exclude/mask lists.
 *
 * @public
 */
export interface PreviewField {
  /** Field name or dot-notation path. */
  name: string;
  /** How to match the field. Defaults to `FieldMatchMode.ANYWHERE`. */
  match?: FieldMatchMode;
}

/**
 * Configuration for the preview feature of {@link createFileSystemSerdes}.
 *
 * When configured, a subset of the original value is stored inline in the
 * checkpoint envelope alongside the file pointer, making it visible in the
 * console and API without reading the full file.
 *
 * @public
 */
export interface PreviewConfig {
  /**
   * Whether to start with all fields included or all excluded.
   */
  mode: PreviewMode;
  /**
   * Fields to include (used with `EXCLUDE_ALL` mode, or to override `INCLUDE_ALL`).
   */
  include?: PreviewField[];
  /**
   * Fields to exclude (used with `INCLUDE_ALL` mode, or to override `EXCLUDE_ALL`).
   */
  exclude?: PreviewField[];
  /**
   * Fields to mask — if visible, their value is replaced with `maskString`.
   */
  mask?: PreviewField[];
  /**
   * String used to replace masked field values.
   * @defaultValue `"***"`
   */
  maskString?: string;
  /**
   * Maximum size in bytes for the preview object (JSON-serialized).
   * Fields are added until this limit is reached.
   * @defaultValue `4096`
   */
  maxPreviewBytes?: number;
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
   * When set, a preview of the value is stored inline in the checkpoint
   * envelope alongside the file pointer.
   */
  preview?: PreviewConfig;
}

/**
 * Creates a Serdes that stores serialized values on the filesystem.
 *
 * Designed for use with Lambda functions that mount an Amazon S3 bucket as a
 * filesystem via S3 Files, enabling durable, shared state across invocations
 * and parallel function instances without checkpoint size constraints.
 *
/** @internal */
type FileSystemEnvelope =
  | { data: string }
  | { file: string; preview?: Record<string, unknown> };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function writeToFile(
  basePath: string,
  value: any,
  context: SerdesContext,
): Promise<string> {
  const dir = join(basePath, encodeURIComponent(context.durableExecutionArn));
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${context.entityId}.json`);
  await writeFile(filePath, JSON.stringify(value), "utf-8");
  return filePath;
}

/** Returns true if the field at `path` (dot-notation) matches the given PreviewField rule. */
function fieldMatches(path: string, field: PreviewField): boolean {
  const mode = field.match ?? FieldMatchMode.ANYWHERE;
  if (mode === FieldMatchMode.PATH) {
    return path === field.name;
  }
  // ANYWHERE: match if any segment of the path equals the field name
  return path.split(".").includes(field.name);
}

function isMatched(path: string, fields: PreviewField[] | undefined): boolean {
  return fields?.some((f) => fieldMatches(path, f)) ?? false;
}

/**
 * Builds a preview object from `value` according to `config`.
 * Only top-level and nested scalar/object fields are included (no special array handling).
 * Fields are added until `maxPreviewBytes` is reached.
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildPreview(
  value: any,
  config: PreviewConfig,
): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object") return undefined;

  const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
  const maskString = config.maskString ?? "***";
  const maxBytes = config.maxPreviewBytes ?? 4096;

  // Step 1: collect flat (path, displayValue) pairs
  const pairs: Array<[string, unknown]> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function collect(obj: any, pathPrefix: string): void {
    if (obj === null || typeof obj !== "object") return;

    // Recurse into arrays transparently (indices are not part of the path)
    if (Array.isArray(obj)) {
      for (const item of obj) {
        collect(item, pathPrefix);
      }
      return;
    }

    for (const key of Object.keys(obj)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      const path = pathPrefix ? `${pathPrefix}.${key}` : key;
      const masked = isMatched(path, config.mask);
      const excluded = isMatched(path, config.exclude);
      const visible =
        !excluded &&
        (masked ||
          (config.mode === PreviewMode.INCLUDE_ALL
            ? true
            : isMatched(path, config.include)));

      if (!visible) {
        collect(obj[key], path);
        continue;
      }

      if (masked) {
        pairs.push([path, maskString]);
        continue;
      }

      // Recurse into objects/arrays; push scalars directly
      if (obj[key] !== null && typeof obj[key] === "object") {
        collect(obj[key], path);
      } else {
        pairs.push([path, obj[key]]);
      }
    }
  }

  collect(value, "");
  if (pairs.length === 0) return undefined;

  // Step 2: filter pairs by maxPreviewBytes using incremental size tracking (O(n)),
  // then build the nested object once from accepted pairs.
  // Using flat path as key for size estimation — slightly over-estimates for nested
  // keys but is safe (never under-estimates).
  const accepted: Array<[string, unknown]> = [];
  let estimatedSize = 2; // "{}"
  for (const [path, val] of pairs) {
    const entrySize = Buffer.byteLength(
      `"${path}":${JSON.stringify(val)},`,
      "utf-8",
    );
    if (estimatedSize + entrySize > maxBytes) break;
    accepted.push([path, val]);
    estimatedSize += entrySize;
  }

  if (accepted.length === 0) return undefined;

  // Build nested structure from accepted pairs in O(n).
  // Keys are safe at this point — dangerous keys were filtered in collect().
  const result: Record<string, unknown> = {};
  for (const [path, val] of accepted) {
    const parts = path.split(".");
    let node = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof node[parts[i]] !== "object" || node[parts[i]] === null) {
        node[parts[i]] = {};
      }
      node = node[parts[i]] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = val;
  }

  return Object.keys(result).length > 0 ? result : undefined;
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
 *     preview: {
 *       mode: PreviewMode.EXCLUDE_ALL,
 *       include: [{ name: "id" }, { name: "status" }],
 *       mask: [{ name: "email" }],
 *     },
 *   }),
 * });
 * ```
 *
 * @public
 */
export function createFileSystemSerdes(
  basePath: string,
  config: FileSystemSerdesConfig = {},
): AnySerdes {
  const storageMode = config.storageMode ?? FileSystemSerdesMode.ALWAYS;
  return {
    serialize: async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      value: any,
      context: SerdesContext,
    ): Promise<string | undefined> => {
      if (value === undefined) return undefined;

      if (storageMode === FileSystemSerdesMode.ALWAYS) {
        const filePath = await writeToFile(basePath, value, context);
        const preview = config.preview
          ? buildPreview(value, config.preview)
          : undefined;
        const envelope: FileSystemEnvelope = preview
          ? { file: filePath, preview }
          : { file: filePath };
        return JSON.stringify(envelope);
      }

      // OVERFLOW mode: serialize inline first, overflow to file if too large
      const inlineJson = JSON.stringify(value);
      if (Buffer.byteLength(inlineJson, "utf-8") > OVERFLOW_THRESHOLD_BYTES) {
        const filePath = await writeToFile(basePath, value, context);
        const preview = config.preview
          ? buildPreview(value, config.preview)
          : undefined;
        const envelope: FileSystemEnvelope = preview
          ? { file: filePath, preview }
          : { file: filePath };
        return JSON.stringify(envelope);
      }
      return JSON.stringify({ data: inlineJson } as FileSystemEnvelope);
    },

    deserialize: async (
      data: string | undefined,
      _context: SerdesContext,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
