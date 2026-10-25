import assert from "node:assert/strict";
import { test } from "node:test";
import { createLambdaLogExporter } from "../src/exporters/lambda-log.js";
import { buildRecord } from "../src/index.js";
import { withOperationsByName } from "../src/operations-by-name.js";
import { ARN } from "./helpers.js";

const record = buildRecord({
  arn: ARN,
  status: "SUCCEEDED",
  emittedAt: new Date("2026-01-01T00:00:10.000Z"),
  operations: [
    { Id: "e", Type: "EXECUTION", Status: "STARTED", StartTimestamp: 1 },
    {
      Id: "1",
      Name: "charge",
      Type: "STEP",
      Status: "SUCCEEDED",
      StartTimestamp: 1,
      EndTimestamp: 2,
    },
  ],
});

test("writes the record with operationsByName as one console.log line", async (t) => {
  const log = t.mock.method(console, "log", () => {});
  const exporter = createLambdaLogExporter();
  assert.equal(exporter.maxRecordBytes, 256_000);
  await exporter.export(record);
  assert.equal(log.mock.callCount(), 1);
  const [line] = log.mock.calls[0].arguments;
  assert.equal(line, JSON.stringify(withOperationsByName(record)));
  assert.equal(line.includes("\n"), false);
  const logged = JSON.parse(line);
  assert.equal(logged.operations, undefined);
  assert.equal(logged.operationsByName.charge.status, "SUCCEEDED");
});

test("maxRecordBytes can be set", () => {
  assert.equal(
    createLambdaLogExporter({ maxRecordBytes: 1 }).maxRecordBytes,
    1,
  );
  assert.equal(createLambdaLogExporter({}).maxRecordBytes, 256_000);
});
