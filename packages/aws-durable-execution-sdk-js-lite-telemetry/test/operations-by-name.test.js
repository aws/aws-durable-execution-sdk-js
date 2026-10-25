import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecord } from "../src/index.js";
import {
  applyOperationsFormat,
  buildOperationsByName,
} from "../src/operations-by-name.js";
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
const byName = buildOperationsByName(record.operations);

test('"array" returns the record unchanged', () => {
  assert.equal(applyOperationsFormat(record, "array"), record);
});

test('"by-name" replaces operations with operationsByName', () => {
  const { operations, ...rest } = record;
  const formatted = applyOperationsFormat(record, "by-name");
  assert.deepEqual(formatted, { ...rest, operationsByName: byName });
  assert.equal("operations" in formatted, false);
  assert.equal(formatted.operationsByName.charge.status, "SUCCEEDED");
});

test('"both" keeps operations and adds operationsByName as the last field', () => {
  const formatted = applyOperationsFormat(record, "both");
  assert.deepEqual(formatted, { ...record, operationsByName: byName });
  // The full SDK spreads the record and then adds operationsByName. So the JSON has
  // operationsByName after every field of the record.
  assert.equal(Object.keys(formatted).at(-1), "operationsByName");
  assert.equal(formatted.operations, record.operations);
});

test("undefined and an unknown value return the record unchanged", () => {
  assert.equal(applyOperationsFormat(record, undefined), record);
  assert.equal(applyOperationsFormat(record, "map"), record);
});
