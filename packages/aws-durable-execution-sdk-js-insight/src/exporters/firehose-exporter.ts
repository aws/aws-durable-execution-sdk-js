import { FirehoseClient, PutRecordCommand } from "@aws-sdk/client-firehose";
import type { InsightExporter, WorkflowInsightRecord } from "../types";

/**
 * Configuration for the Kinesis Firehose exporter.
 * @experimental This interface is experimental and may change in future releases.
 */
export interface FirehoseExporterConfig {
  /** Firehose delivery stream name. */
  deliveryStreamName: string;

  /** AWS region. If omitted, uses the SDK default. */
  region?: string;
}

/**
 * Exports workflow insight records to Amazon Kinesis Data Firehose.
 *
 * Each record is sent as a newline-delimited JSON blob via PutRecord.
 * Firehose handles buffering, batching, and delivery to the configured
 * destination (S3, Redshift, Splunk, HTTP endpoint, etc.).
 *
 * A trailing newline is appended so that when Firehose concatenates records
 * into S3 objects, they remain parseable as newline-delimited JSON (NDJSON).
 *
 * @experimental This class is experimental and may change in future releases.
 */
export class FirehoseExporter implements InsightExporter {
  private readonly deliveryStreamName: string;
  private readonly client: FirehoseClient;

  constructor(config: FirehoseExporterConfig) {
    this.deliveryStreamName = config.deliveryStreamName;
    this.client = new FirehoseClient(
      config.region ? { region: config.region } : {},
    );
  }

  async export(record: WorkflowInsightRecord): Promise<void> {
    const data = JSON.stringify(record) + "\n";

    await this.client.send(
      new PutRecordCommand({
        DeliveryStreamName: this.deliveryStreamName,
        Record: {
          Data: new TextEncoder().encode(data),
        },
      }),
    );
  }

  async flush(): Promise<void> {
    // No buffering — each export is a single PutRecord.
  }
}
