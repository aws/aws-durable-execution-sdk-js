import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  InsightExporter,
  OperationsFormat,
  WorkflowInsightRecord,
} from "../types";
import { applyOperationsFormat } from "../operations-index";

/**
 * Configuration for the file exporter.
 * @experimental This interface is experimental and may change in future releases.
 */
export interface FileExporterConfig {
  /**
   * Base directory to write files to.
   * e.g. "/mnt/efs/workflow-insight" (EFS mount) or "/tmp/insight" (ephemeral).
   */
  directory: string;

  /**
   * File output mode.
   * - "ndjson": append all records to a single NDJSON file per function+date (default)
   * - "json": write one JSON file per execution (overwrites on update)
   * Default: "ndjson"
   */
  mode?: "ndjson" | "json";

  /**
   * How operations are rendered in the written record: the canonical `operations`
   * array (`"array"`, default), the `operationsByName` map (`"by-name"`), or
   * `"both"`.
   */
  operationsFormat?: OperationsFormat;
}

/**
 * Exports workflow insight records to the filesystem (EFS, S3 mounted drive,
 * or any writable path).
 *
 * In "ndjson" mode, records are appended to a date-partitioned file:
 *   {directory}/{YYYY-MM-DD}.ndjson
 *
 * In "json" mode, each execution gets its own file (upsert on update):
 *   {directory}/{executionName}.json
 *
 * Works with Lambda EFS mounts, S3 File Gateway, or /tmp for testing.
 *
 * @experimental This class is experimental and may change in future releases.
 */
export class FileExporter implements InsightExporter {
  private readonly directory: string;
  private readonly mode: "ndjson" | "json";
  private readonly operationsFormat: OperationsFormat;
  private dirCreated = false;

  constructor(config: FileExporterConfig) {
    this.directory = config.directory;
    this.mode = config.mode ?? "ndjson";
    this.operationsFormat = config.operationsFormat ?? "array";
  }

  async export(record: WorkflowInsightRecord): Promise<void> {
    await this.ensureDir();

    const formatted = applyOperationsFormat(record, this.operationsFormat);

    if (this.mode === "ndjson") {
      const date = record.emittedAt.slice(0, 10); // YYYY-MM-DD
      const filePath = join(this.directory, `${date}.ndjson`);
      await appendFile(filePath, JSON.stringify(formatted) + "\n", "utf-8");
    } else {
      const fileName =
        sanitize(record.executionName ?? record.executionArn) + ".json";
      const filePath = join(this.directory, fileName);
      const { writeFile } = await import("node:fs/promises");
      await writeFile(filePath, JSON.stringify(formatted, null, 2), "utf-8");
    }
  }

  async flush(): Promise<void> {
    // No buffering — writes are immediate.
  }

  private async ensureDir(): Promise<void> {
    if (this.dirCreated) return;
    await mkdir(this.directory, { recursive: true });
    this.dirCreated = true;
  }
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
