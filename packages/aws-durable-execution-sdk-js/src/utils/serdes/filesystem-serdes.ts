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

/** @internal */
type FileSystemEnvelope = { data: string } | { file: string };

async function writeToFile(
  basePath: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
 * Configuration options for {@link createFileSystemSerdes}.
 *
 * @public
 */
export interface FileSystemSerdesConfig {
  /**
   * Controls when data is written to the filesystem.
   * @defaultValue `FileSystemSerdesMode.ALWAYS`
   */
  mode?: FileSystemSerdesMode;
}

/**
 * Creates a Serdes that stores serialized values on the filesystem.
 *
 * Designed for use with Lambda functions that mount an Amazon S3 bucket as a
 * filesystem via S3 Files, enabling durable, shared state across invocations
 * and parallel function instances without checkpoint size constraints.
 *
 * The checkpoint stores a JSON envelope that is either:
 * - `{"data":"<inline JSON>"}` — value stored inline (OVERFLOW mode, under threshold)
 * - `{"file":"<path>"}` — value stored in a file (ALWAYS mode, or OVERFLOW above threshold)
 *
 * @param basePath - Directory path where data files will be stored (e.g. the S3 Files mount point)
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
 *   defaultSerdes: createFileSystemSerdes("/mnt/s3", { mode: FileSystemSerdesMode.OVERFLOW }),
 * });
 * ```
 *
 * @public
 */
export function createFileSystemSerdes(
  basePath: string,
  config: FileSystemSerdesConfig = {},
): AnySerdes {
  const mode = config.mode ?? FileSystemSerdesMode.ALWAYS;
  return {
    serialize: async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      value: any,
      context: SerdesContext,
    ): Promise<string | undefined> => {
      if (value === undefined) return undefined;

      if (mode === FileSystemSerdesMode.ALWAYS) {
        const filePath = await writeToFile(basePath, value, context);
        const envelope: FileSystemEnvelope = { file: filePath };
        return JSON.stringify(envelope);
      }

      // OVERFLOW mode: serialize inline first, overflow to file if too large
      const inlineJson = JSON.stringify(value);
      const envelope: FileSystemEnvelope =
        Buffer.byteLength(inlineJson, "utf-8") > OVERFLOW_THRESHOLD_BYTES
          ? { file: await writeToFile(basePath, value, context) }
          : { data: inlineJson };

      return JSON.stringify(envelope);
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
