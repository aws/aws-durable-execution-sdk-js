import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import type { InsightExporter, WorkflowInsightRecord } from "../types";

/**
 * Configuration for the S3 exporter.
 * @experimental This interface is experimental and may change in future releases.
 */
export interface S3ExporterConfig {
  /** S3 bucket name to write records to. */
  bucket: string;

  /** Key prefix for objects. Default: "workflow-insight/" */
  prefix?: string;

  /**
   * How to partition objects in S3.
   * - "date": partition by date (e.g. prefix/year=2026/month=06/day=16/exec.json)
   * - "function-name": partition by function name
   * - "none": flat under prefix
   * Default: "date"
   */
  partitioning?: "date" | "function-name" | "none";

  /** AWS region of the bucket. If omitted, uses the SDK default. */
  region?: string;

  /**
   * Max serialized record size before truncation.
   * Default: 5_000_000 (S3 has no small per-object limit; a generous guard).
   */
  maxRecordSizeBytes?: number;
}

/**
 * Exports workflow insight records to Amazon S3.
 *
 * Each record is written as a JSON object keyed by execution name, so
 * subsequent updates to the same execution **overwrite** the same object.
 * This makes the data queryable via Amazon Athena without deduplication.
 *
 * @experimental This class is experimental and may change in future releases.
 */
export class S3Exporter implements InsightExporter {
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly partitioning: "date" | "function-name" | "none";
  private readonly client: S3Client;
  readonly maxRecordSizeBytes: number;

  constructor(config: S3ExporterConfig) {
    this.bucket = config.bucket;
    this.prefix = config.prefix ?? "workflow-insight/";
    this.partitioning = config.partitioning ?? "date";
    this.maxRecordSizeBytes = config.maxRecordSizeBytes ?? 5_000_000;
    this.client = new S3Client(config.region ? { region: config.region } : {});
  }

  async export(record: WorkflowInsightRecord): Promise<void> {
    const key = this.buildKey(record);
    const body = JSON.stringify(record);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: "application/json",
      }),
    );
  }

  async flush(): Promise<void> {
    // No buffering — each export is a single PutObject.
  }

  private buildKey(record: WorkflowInsightRecord): string {
    const partition = this.buildPartition(record);
    // Use executionName (stable across invocations) as the filename so that
    // updates to the same execution overwrite the same S3 object.
    const fileName =
      sanitize(record.executionName ?? record.executionArn) + ".json";
    return `${this.prefix}${partition}${fileName}`;
  }

  private buildPartition(record: WorkflowInsightRecord): string {
    switch (this.partitioning) {
      case "date": {
        const d = new Date(record.startTime);
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, "0");
        const day = String(d.getUTCDate()).padStart(2, "0");
        return `year=${year}/month=${month}/day=${day}/`;
      }
      case "function-name":
        return `function=${sanitize(record.functionName)}/`;
      case "none":
        return "";
    }
  }
}

/** Replace characters that are problematic in S3 keys. */
function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
