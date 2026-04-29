import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Serdes, SerdesContext } from "./serdes";

/**
 * Creates a Serdes that stores serialized values as JSON files on the filesystem.
 *
 * Designed for use with Lambda functions that mount an Amazon S3 bucket as a
 * filesystem via S3 Files, enabling durable, shared state across invocations
 * and parallel function instances without size constraints of checkpoint payloads.
 *
 * The serialized pointer stored in the checkpoint is the file path, not the data itself.
 * On deserialization, the file is read and parsed back to the original value.
 *
 * @param basePath - Directory path where data files will be stored (e.g. the S3 Files mount point)
 * @returns A Serdes that reads/writes JSON files under basePath
 *
 * @example
 * ```typescript
 * // Mount path configured via S3 Files in Lambda
 * const s3Serdes = createFileSystemSerdes("/mnt/s3");
 *
 * context.configureSerdes({ defaultSerdes: s3Serdes });
 *
 * // Large result is written to /mnt/s3/<executionArn>/<entityId>.json
 * const result = await context.step("process-large-data", async () => largeObject);
 * ```
 *
 * @public
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createFileSystemSerdes(basePath: string): Serdes<any> {
  return {
    serialize: async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      value: any,
      context: SerdesContext,
    ): Promise<string | undefined> => {
      if (value === undefined) return undefined;

      const dir = join(
        basePath,
        encodeURIComponent(context.durableExecutionArn),
      );
      await mkdir(dir, { recursive: true });

      const filePath = join(dir, `${context.entityId}.json`);
      await writeFile(filePath, JSON.stringify(value), "utf-8");
      return filePath;
    },

    deserialize: async (
      data: string | undefined,
      _context: SerdesContext,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): Promise<any> => {
      if (data === undefined) return undefined;
      const contents = await readFile(data, "utf-8");
      return JSON.parse(contents);
    },
  };
}
