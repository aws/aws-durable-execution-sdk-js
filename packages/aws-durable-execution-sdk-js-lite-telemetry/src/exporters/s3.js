import { createAwsClient } from "../aws.js";

// The full SDK's sanitize: every character other than letters, digits, ".", "_" and "-"
// becomes "_". So an ARN's ":" and "/" never reach the key.
const sanitize = (value) => value.replace(/[^a-zA-Z0-9._-]/g, "_");

// S3 signs the path as it is sent. So the path must already be encoded with RFC 3986.
// encodeURIComponent leaves !'()* unencoded, so they are encoded too. The "/" between
// segments stays, because it separates the prefixes of the key.
const encodeKey = (key) =>
  key
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");

// The full SDK's partitions. The Glue table of the full SDK's CDK stack projects
// year=/month=/day= under the default prefix. So the date is the UTC date of startTime,
// with a two-digit month and day.
function partition(partitioning, record) {
  if (partitioning === "date") {
    const [year, month, day] = record.startTime.slice(0, 10).split("-");
    return `year=${year}/month=${month}/day=${day}/`;
  }
  if (partitioning === "function-name") {
    return `function=${sanitize(record.functionName)}/`;
  }
  return "";
}

// Writes each record as one JSON object, as in the full SDK's S3Exporter. The file name
// is the execution name. startTime and the execution name do not change between
// invocations. So each record of one execution replaces the same object.
export function createS3Exporter({
  bucket,
  keyPrefix = "durable-execution-telemetry/",
  partitioning = "date",
  region,
  endpoint,
  client = createAwsClient({
    service: "s3",
    region,
    endpoint:
      endpoint ??
      `https://${bucket}.s3.${region ?? process.env.AWS_REGION}.amazonaws.com`,
  }),
  // S3 accepts objects up to 5 GB in one PUT. The full SDK uses 5_000_000 as a guard.
  maxRecordBytes = 5_000_000,
}) {
  return {
    maxRecordBytes,
    async export(record) {
      const fileName = `${sanitize(record.executionName ?? record.executionArn)}.json`;
      const key = `${keyPrefix}${partition(partitioning, record)}${fileName}`;
      await client.send({
        method: "PUT",
        path: `/${encodeKey(key)}`,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(record),
      });
    },
  };
}
