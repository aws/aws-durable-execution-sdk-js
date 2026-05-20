import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  return {
    serialize: async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      value: any,
      context: SerdesContext,
    ): Promise<string | undefined> => {
      if (value === undefined) return undefined;

      if (storageMode === FileSystemSerdesMode.ALWAYS) {
        const filePath = await writeToFile(basePath, value, context);
        const preview = config.generatePreview?.(value);
        const envelope: FileSystemEnvelope = preview
          ? { file: filePath, preview }
          : { file: filePath };
        return JSON.stringify(envelope);
      }

      // OVERFLOW mode: serialize inline first, overflow to file if too large
      const inlineJson = JSON.stringify(value);
      if (Buffer.byteLength(inlineJson, "utf-8") > OVERFLOW_THRESHOLD_BYTES) {
        const filePath = await writeToFile(basePath, value, context);
        const preview = config.generatePreview?.(value);
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
