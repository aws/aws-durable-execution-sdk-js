import { withOperationsByName } from "../operations-by-name.js";

// Writes each record as one line to stdout, as in the full SDK's LambdaLogExporter.
// Lambda sends stdout to the function's own log group. So the exporter needs no IAM
// permission and no client. The line holds operationsByName instead of operations, as
// in the CloudWatch Logs exporter. So Logs Insights can read operationsByName.NAME.status.
export function createLambdaLogExporter({
  // CloudWatch Logs limits an event to 256 KiB. Lambda adds a prefix to each line. The
  // full SDK uses 256_000, which leaves room for the prefix.
  maxRecordBytes = 256_000,
} = {}) {
  return {
    maxRecordBytes,
    async export(record) {
      // JSON.stringify writes no newline. So the record is one log event. The Lambda
      // Node.js runtime adds the request id to each console.log line. process.stdout
      // would bypass the runtime. So the exporter uses console.log, as the full SDK does.
      // biome-ignore lint/suspicious/noConsole: writing to the log is this exporter's job.
      console.log(JSON.stringify(withOperationsByName(record)));
    },
  };
}
