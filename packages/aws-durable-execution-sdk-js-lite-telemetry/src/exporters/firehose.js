import { createAwsClient } from "../aws.js";
import { applyOperationsFormat } from "../operations-by-name.js";

// Sends each record to a Firehose delivery stream with one PutRecord call. Firehose
// buffers the records and delivers them to the destination of the stream.
export function createFirehoseExporter({
  deliveryStreamName,
  region,
  endpoint,
  client = createAwsClient({ service: "firehose", region, endpoint }),
  // Firehose limits the data of one record to 1,000 KiB, before base64. The plugin
  // measures the record JSON without the newline, so the data is one byte larger. The
  // full SDK's value of 1_000_000 leaves room for that byte.
  maxRecordBytes = 1_000_000,
  // "array", "by-name" or "both", as in the full SDK. See applyOperationsFormat.
  operationsFormat = "array",
}) {
  return {
    maxRecordBytes,
    async export(record) {
      // Firehose concatenates the records into one S3 object without a separator. The
      // newline keeps the object parseable as newline-delimited JSON, as in the full SDK.
      const data = `${JSON.stringify(applyOperationsFormat(record, operationsFormat))}\n`;
      // Firehose uses the AWS JSON 1.1 protocol: POST / with the action in
      // x-amz-target. The protocol carries a blob as a base64 string.
      await client.send({
        path: "/",
        headers: {
          "content-type": "application/x-amz-json-1.1",
          "x-amz-target": "Firehose_20150804.PutRecord",
        },
        body: JSON.stringify({
          DeliveryStreamName: deliveryStreamName,
          Record: { Data: Buffer.from(data).toString("base64") },
        }),
      });
    },
  };
}
