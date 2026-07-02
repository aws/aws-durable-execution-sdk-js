import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type {
  InsightExporter,
  OperationsFormat,
  WorkflowInsightRecord,
} from "../types";
import { applyOperationsFormat } from "../operations-index";

/**
 * Configuration for the SQS exporter.
 * @experimental This interface is experimental and may change in future releases.
 */
export interface SQSExporterConfig {
  /** SQS queue URL. */
  queueUrl: string;

  /**
   * Message group ID (required for FIFO queues, ignored for standard).
   * Default: the executionArn (groups messages per execution).
   */
  messageGroupId?: string;

  /** AWS region. If omitted, uses the SDK default. */
  region?: string;

  /**
   * How operations are rendered in the message body: the canonical `operations`
   * array (`"array"`, default), the `operationsByName` map (`"by-name"`), or
   * `"both"`. Choose based on what your consumer expects.
   */
  operationsFormat?: OperationsFormat;
}

/**
 * Exports workflow insight records to Amazon SQS via SendMessage.
 *
 * Each record is sent as a single message with the full JSON as the body.
 * For FIFO queues, the message deduplication ID is derived from
 * executionArn + emittedAt to prevent duplicates while allowing updates.
 *
 * Use this when you need guaranteed delivery to a single consumer or want
 * to decouple export processing from the Lambda invocation.
 *
 * @experimental This class is experimental and may change in future releases.
 */
export class SQSExporter implements InsightExporter {
  private readonly queueUrl: string;
  private readonly messageGroupId?: string;
  private readonly isFifo: boolean;
  private readonly operationsFormat: OperationsFormat;
  private readonly client: SQSClient;

  constructor(config: SQSExporterConfig) {
    this.queueUrl = config.queueUrl;
    this.messageGroupId = config.messageGroupId;
    this.isFifo = config.queueUrl.endsWith(".fifo");
    this.operationsFormat = config.operationsFormat ?? "array";
    this.client = new SQSClient(config.region ? { region: config.region } : {});
  }

  async export(record: WorkflowInsightRecord): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(
          applyOperationsFormat(record, this.operationsFormat),
        ),
        MessageGroupId: this.isFifo
          ? (this.messageGroupId ?? record.executionArn)
          : undefined,
        MessageDeduplicationId: this.isFifo
          ? `${record.executionArn}:${record.emittedAt}`
          : undefined,
        MessageAttributes: {
          status: { DataType: "String", StringValue: record.status },
          functionName: {
            DataType: "String",
            StringValue: record.functionName,
          },
        },
      }),
    );
  }

  async flush(): Promise<void> {
    // No buffering — each export is a single SendMessage.
  }
}
