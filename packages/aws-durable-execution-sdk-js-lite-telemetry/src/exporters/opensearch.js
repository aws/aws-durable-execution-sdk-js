import { createAwsClient } from "../aws.js";

// The document id is the executionArn. Its ":" and "/" must not reach the path unencoded,
// because "/" separates the segments of the path. So the id is encoded with RFC 3986:
// encodeURIComponent leaves !'()* unencoded, so they are encoded too. The client then
// signs the path encoded once more, as for every service other than S3.
const encodeId = (value) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

// Indexes each record as one document, as in the full SDK's OpenSearchExporter. The
// document id is the executionArn. So each record of one execution replaces the same
// document.
export function createOpenSearchExporter({
  endpoint,
  indexName = "durable-execution-telemetry",
  region,
  client = createAwsClient({ service: "es", region, endpoint }),
  // OpenSearch accepts large documents. The full SDK uses 10_000_000 as a guard.
  maxRecordBytes = 10_000_000,
}) {
  return {
    maxRecordBytes,
    async export(record) {
      await client.send({
        method: "PUT",
        // Index names cannot hold "/", ":", "#", "?" or spaces. So the index name is sent
        // as it is, as in the full SDK.
        path: `/${indexName}/_doc/${encodeId(record.executionArn)}`,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(record),
      });
    },
  };
}
