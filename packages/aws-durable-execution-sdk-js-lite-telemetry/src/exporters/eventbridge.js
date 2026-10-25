import { createAwsClient } from "../aws.js";

// Publishes each record as one event, as in the full SDK's EventBridgeExporter. Rules
// match the event on its source and detail-type. So the detail-type is the record status.
export function createEventBridgeExporter({
  eventBusName = "default",
  // EventBridge reserves the "aws." prefix for AWS services.
  source = "software.amazon.lambda.durable.telemetry",
  region,
  endpoint,
  client = createAwsClient({ service: "events", region, endpoint }),
  // EventBridge limits a PutEvents entry to 256 KB. The full SDK uses 256_000.
  maxRecordBytes = 256_000,
} = {}) {
  return {
    maxRecordBytes,
    async export(record) {
      // EventBridge uses the AWS JSON 1.1 protocol: POST / with the action in x-amz-target.
      const result = await client.send({
        path: "/",
        headers: {
          "content-type": "application/x-amz-json-1.1",
          "x-amz-target": "AWSEvents.PutEvents",
        },
        body: JSON.stringify({
          Entries: [
            {
              EventBusName: eventBusName,
              Source: source,
              DetailType: record.status,
              Detail: JSON.stringify(record),
              // AWS JSON 1.1 sends a timestamp as epoch seconds.
              Time: Date.parse(record.emittedAt) / 1000,
            },
          ],
        }),
      });
      // PutEvents answers HTTP 200 when an entry fails. The response then counts the
      // failed entries and holds the error in the entry. The client rejects only an
      // error status. So the exporter throws here, and the plugin logs the lost record.
      if (result.FailedEntryCount > 0) {
        const [entry] = result.Entries;
        throw new Error(
          `EventBridge PutEvents failed: ${entry.ErrorCode} — ${entry.ErrorMessage}`,
        );
      }
    },
  };
}
