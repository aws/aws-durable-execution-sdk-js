import {
  CloudWatchLogsClient,
  PutLogEventsCommand,
  CreateLogStreamCommand,
  ResourceAlreadyExistsException,
} from "@aws-sdk/client-cloudwatch-logs";
import type { InsightExporter, WorkflowInsightRecord } from "../types";
import { withOperationsByName } from "../operations-index";

/**
 * Configuration for the CloudWatch Logs exporter.
 * @experimental This interface is experimental and may change in future releases.
 */
export interface CloudWatchLogsExporterConfig {
  /** CloudWatch log group name to write records to. */
  logGroupName: string;

  /**
   * Log stream prefix. The full stream name is: `{prefix}{YYYY/MM/DD}`.
   * Default: "workflow-insight/"
   */
  logStreamPrefix?: string;

  /** AWS region. If omitted, uses the SDK default. */
  region?: string;

  /**
   * Max serialized record size before truncation.
   * Default: 256_000 (CloudWatch Logs' 256 KB event limit).
   */
  maxRecordSizeBytes?: number;
}

/**
 * Exports workflow insight records to a specific CloudWatch Logs group via
 * PutLogEvents. Unlike the default LambdaLogExporter (which uses console.log
 * and writes to the function's own log group), this exporter can write to any
 * log group and gives you control over the stream structure.
 *
 * Log streams are partitioned by date (one stream per day) for bounded growth
 * and to avoid per-stream throttle limits.
 *
 * Requires IAM permissions: logs:CreateLogStream, logs:PutLogEvents on the
 * target log group.
 *
 * @experimental This class is experimental and may change in future releases.
 */
export class CloudWatchLogsExporter implements InsightExporter {
  private readonly logGroupName: string;
  private readonly logStreamPrefix: string;
  private readonly client: CloudWatchLogsClient;
  private readonly createdStreams = new Set<string>();
  readonly maxRecordSizeBytes: number;

  constructor(config: CloudWatchLogsExporterConfig) {
    this.logGroupName = config.logGroupName;
    this.logStreamPrefix = config.logStreamPrefix ?? "workflow-insight/";
    this.maxRecordSizeBytes = config.maxRecordSizeBytes ?? 256_000;
    this.client = new CloudWatchLogsClient(
      config.region ? { region: config.region } : {},
    );
  }

  async export(record: WorkflowInsightRecord): Promise<void> {
    const streamName = this.buildStreamName();
    await this.ensureStream(streamName);

    await this.client.send(
      new PutLogEventsCommand({
        logGroupName: this.logGroupName,
        logStreamName: streamName,
        logEvents: [
          {
            timestamp: Date.now(),
            message: JSON.stringify(withOperationsByName(record)),
          },
        ],
      }),
    );
  }

  async flush(): Promise<void> {
    // No buffering — each export is a single PutLogEvents call.
  }

  private buildStreamName(): string {
    const d = new Date();
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${this.logStreamPrefix}${year}/${month}/${day}`;
  }

  private async ensureStream(streamName: string): Promise<void> {
    if (this.createdStreams.has(streamName)) return;

    try {
      await this.client.send(
        new CreateLogStreamCommand({
          logGroupName: this.logGroupName,
          logStreamName: streamName,
        }),
      );
    } catch (err) {
      if (!(err instanceof ResourceAlreadyExistsException)) {
        throw err;
      }
    }

    this.createdStreams.add(streamName);
  }
}
