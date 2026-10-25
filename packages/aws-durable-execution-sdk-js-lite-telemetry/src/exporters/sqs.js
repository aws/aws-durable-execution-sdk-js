import { createHash } from "node:crypto";
import { createAwsClient } from "../aws.js";

// SQS limits a FIFO MessageGroupId and MessageDeduplicationId to 128 characters. Most
// execution ARNs are longer. So a longer id is replaced by the hex SHA-256 digest of its
// UTF-8 bytes, 64 characters. The full SDK and the Python and Java exporters use the
// same rule. So the same input gives the same id.
const fifoId = (value) =>
  value.length <= 128
    ? value
    : createHash("sha256").update(value, "utf8").digest("hex");

// Sends each record as one message, as in the full SDK's SQSExporter.
export function createSQSExporter({
  queueUrl,
  messageGroupId,
  region,
  endpoint,
  client = createAwsClient({ service: "sqs", region, endpoint }),
  // SQS limits a message to 256 KiB. The full SDK uses 256_000.
  maxRecordBytes = 256_000,
}) {
  // SQS requires both ids for a FIFO queue and rejects them for a standard queue. The
  // name of a FIFO queue ends with ".fifo".
  const fifo = queueUrl.endsWith(".fifo");

  return {
    maxRecordBytes,
    async export(record) {
      // JSON.stringify leaves out undefined fields. So a standard queue sends no ids.
      const input = {
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(record),
        // An empty messageGroupId counts as omitted, as in the full SDK.
        MessageGroupId: fifo
          ? fifoId(messageGroupId || record.executionArn)
          : undefined,
        // emittedAt strictly increases within one invocation. So each record of one
        // execution has its own id, and a resend of the same record has the same id.
        MessageDeduplicationId: fifo
          ? fifoId(`${record.executionArn}:${record.emittedAt}`)
          : undefined,
        // Consumers can filter on these attributes without parsing the body.
        MessageAttributes: {
          status: { DataType: "String", StringValue: record.status },
          functionName: {
            DataType: "String",
            StringValue: record.functionName,
          },
        },
      };
      // SQS accepts the AWS JSON 1.0 protocol: POST / with the action in x-amz-target.
      await client.send({
        path: "/",
        headers: {
          "content-type": "application/x-amz-json-1.0",
          "x-amz-target": "AmazonSQS.SendMessage",
        },
        body: JSON.stringify(input),
      });
    },
  };
}
