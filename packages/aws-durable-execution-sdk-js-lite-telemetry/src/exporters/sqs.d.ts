import type {
  AwsClient,
  OperationsFormat,
  TelemetryExporter,
} from "../index.js";

export interface SQSExporterConfig {
  /** The queue URL. A URL that ends with ".fifo" is a FIFO queue. */
  queueUrl: string;
  /** The MessageGroupId of a FIFO queue. Default: the executionArn. "" counts as omitted. Unused for a standard queue. */
  messageGroupId?: string;
  /** The region of the built-in client. Default: process.env.AWS_REGION. Unused with client. */
  region?: string;
  /** Default: `https://sqs.${region}.amazonaws.com`. Unused with client. */
  endpoint?: string;
  /** Default: the built-in client, signed for "sqs" with the Lambda credentials. */
  client?: AwsClient;
  /** Default 256_000. */
  maxRecordBytes?: number;
  /** How the message body holds the operations. See OperationsFormat. Default "array". */
  operationsFormat?: OperationsFormat;
}

/** Sends each record as one SQS message. The body is the record as JSON, in operationsFormat. */
export function createSQSExporter(
  config: SQSExporterConfig,
): TelemetryExporter & { maxRecordBytes: number };
