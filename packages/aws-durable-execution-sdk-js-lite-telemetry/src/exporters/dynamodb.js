import { createAwsClient } from "../aws.js";
import { withOperationsByName } from "../operations-by-name.js";

// A JSON value as a DynamoDB AttributeValue. The value comes from JSON.parse, so it is a
// string, a finite number, a boolean, null, an array or a plain object. DynamoDB allows
// empty strings in non-key attributes, so an empty string stays { S: "" }.
function marshall(value) {
  if (value === null) return { NULL: true };
  if (Array.isArray(value)) return { L: value.map(marshall) };
  if (typeof value === "string") return { S: value };
  if (typeof value === "number") return { N: String(value) };
  if (typeof value === "boolean") return { BOOL: value };
  // Object.fromEntries creates own properties. So a key such as "__proto__" stays a key.
  return {
    M: Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, marshall(v)]),
    ),
  };
}

// Writes each record as one item with PutItem, as in the full SDK's DynamoDBExporter.
// The partition key holds the executionArn. The sort key holds emittedAt. So each
// record is a new item, and the table keeps the history of each execution. With
// sortKey "", each record replaces the item of its execution.
export function createDynamoDBExporter({
  tableName,
  partitionKey = "pk",
  sortKey = "sk",
  region,
  endpoint,
  client = createAwsClient({ service: "dynamodb", region, endpoint }),
  // DynamoDB limits an item to 400 KB. The full SDK uses 400_000. The plugin measures
  // the record with the operations array. The item holds operationsByName instead,
  // which is smaller.
  maxRecordBytes = 400_000,
}) {
  return {
    maxRecordBytes,
    async export(record) {
      const item = {
        ...withOperationsByName(record),
        [partitionKey]: record.executionArn,
      };
      if (sortKey) item[sortKey] = record.emittedAt;
      // The other exporters store the record as JSON. The JSON round trip gives the
      // item the same values: it omits undefined fields, turns NaN and Infinity into
      // null, and turns a Date into its ISO string. So marshall sees only JSON values.
      const json = JSON.parse(JSON.stringify(item));
      // DynamoDB uses the AWS JSON 1.0 protocol: POST / with the action in x-amz-target.
      await client.send({
        path: "/",
        headers: {
          "content-type": "application/x-amz-json-1.0",
          "x-amz-target": "DynamoDB_20120810.PutItem",
        },
        body: JSON.stringify({ TableName: tableName, Item: marshall(json).M }),
      });
    },
  };
}
