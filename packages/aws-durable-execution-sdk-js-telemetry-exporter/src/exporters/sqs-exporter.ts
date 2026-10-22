import { createHash } from "node:crypto";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type {
  TelemetryExporter,
  OperationsFormat,
  DurableExecutionTelemetryRecord,
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
   * Message group ID, sent to FIFO queues only (a standard queue sends none).
   * Default: the executionArn (groups messages per execution). A value longer
   * than 128 characters is replaced by its SHA-256 hex digest. An empty string
   * is treated as omitted (as in the Python exporter): a standard queue sends no
   * group id, and a FIFO queue groups by the executionArn.
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

  /**
   * Max serialized record size before truncation.
   * Default: 256_000 (SQS's 256 KB message limit).
   */
  maxRecordSizeBytes?: number;
}

/**
 * Exports durable execution telemetry records to Amazon SQS via SendMessage.
 *
 * Each record is sent as a single message with the full JSON as the body.
 * For FIFO queues, the message deduplication ID is derived from
 * `executionArn:emittedAt` to prevent duplicates while allowing updates. SQS
 * caps both FIFO ids at 128 characters and realistic execution ARNs are
 * longer, so an id over that limit is replaced by its SHA-256 hex digest
 * (see the internal `fifoId` helper).
 *
 * Use this when you need guaranteed delivery to a single consumer or want
 * to decouple export processing from the Lambda invocation.
 *
 * @experimental This class is experimental and may change in future releases.
 */
export class SQSExporter implements TelemetryExporter {
  private readonly queueUrl: string;
  private readonly messageGroupId?: string;
  private readonly isFifo: boolean;
  private readonly operationsFormat: OperationsFormat;
  private readonly client: SQSClient;
  readonly maxRecordSizeBytes: number;

  constructor(config: SQSExporterConfig) {
    this.queueUrl = config.queueUrl;
    // "" is treated as omitted, so `process.env.GROUP ?? undefined` with an
    // empty variable keeps working on both queue types.
    this.messageGroupId = config.messageGroupId || undefined;
    this.isFifo = config.queueUrl.endsWith(".fifo");
    this.operationsFormat = config.operationsFormat ?? "array";
    this.maxRecordSizeBytes = config.maxRecordSizeBytes ?? 256_000;
    this.client = new SQSClient(config.region ? { region: config.region } : {});
  }

  render(record: DurableExecutionTelemetryRecord): unknown {
    return applyOperationsFormat(record, this.operationsFormat);
  }

  async export(record: DurableExecutionTelemetryRecord): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(this.render(record)),
        MessageGroupId: this.isFifo
          ? fifoId(this.messageGroupId ?? record.executionArn)
          : undefined,
        MessageDeduplicationId: this.isFifo
          ? fifoId(`${record.executionArn}:${record.emittedAt}`)
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

/** SQS's limit on the length of a FIFO `MessageGroupId` and `MessageDeduplicationId`. */
const MAX_FIFO_ID_LENGTH = 128;

/**
 * Returns `value` when it fits the SQS FIFO id limit, otherwise the lowercase
 * hex SHA-256 digest of its UTF-8 bytes (64 characters).
 *
 * The Python and Java exporters apply the same rule to the same input string.
 * The dedup input embeds each SDK's own `emittedAt` string, so dedup ids for
 * the same emission can differ across SDKs.
 *
 * @internal Exported for tests.
 */
export function fifoId(value: string): string {
  if (value.length <= MAX_FIFO_ID_LENGTH) return value;
  return createHash("sha256").update(value, "utf8").digest("hex");
}
