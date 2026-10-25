import {
  CloudWatchLogsClient,
  CreateLogStreamCommand,
  PutLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { withOperationsByName } from "../operations-by-name.js";

// Writes each record as one log event. The stream name ends with the UTC date, so each
// day has a new stream, as in the full SDK's CloudWatchLogsExporter.
export function createCloudWatchLogsExporter({
  logGroupName,
  logStreamPrefix = "durable-execution-telemetry/",
  client = new CloudWatchLogsClient({}),
  // CloudWatch Logs limits an event to 256 KiB minus 26 bytes. The full SDK uses
  // 256_000. The plugin measures the record with the operations array. The message
  // holds operationsByName instead. A summary has no id and no timestamps, so it is
  // smaller than the operation record: about 17% for 1000 steps with distinct names.
  maxRecordBytes = 256_000,
}) {
  // The streams that this exporter created or found. The exporter lives in the plugin
  // factory's closure, so the set lasts for the life of the Lambda sandbox.
  const streams = new Set();

  async function ensureStream(logStreamName) {
    if (streams.has(logStreamName)) return;
    try {
      await client.send(
        new CreateLogStreamCommand({ logGroupName, logStreamName }),
      );
    } catch (err) {
      // Another sandbox, or an earlier sandbox, created the stream.
      if (err?.name !== "ResourceAlreadyExistsException") throw err;
    }
    streams.add(logStreamName);
  }

  return {
    maxRecordBytes,
    async export(record) {
      const now = new Date();
      const logStreamName = `${logStreamPrefix}${now.toISOString().slice(0, 10).replaceAll("-", "/")}`;
      await ensureStream(logStreamName);
      await client.send(
        new PutLogEventsCommand({
          logGroupName,
          logStreamName,
          logEvents: [
            {
              timestamp: now.getTime(),
              message: JSON.stringify(withOperationsByName(record)),
            },
          ],
        }),
      );
    },
  };
}
