import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecord } from "../src/index.js";
import { parseExecutionArn } from "../src/record.js";
import { fitRecord } from "../src/truncate.js";

const ARN =
  "arn:aws:lambda:eu-west-1:111122223333:function:orders:live/durable-execution/order-42/abc123";

test("parseExecutionArn reads the full SDK's ARN format", () => {
  assert.deepEqual(parseExecutionArn(ARN), {
    region: "eu-west-1",
    accountId: "111122223333",
    functionName: "orders",
    qualifier: "live",
    executionName: "order-42",
  });
  assert.deepEqual(parseExecutionArn("not-an-arn"), {
    region: "",
    accountId: "",
    functionName: "",
    qualifier: "",
    executionName: "",
  });
});

test("an ARN without an execution name gives no executionName", () => {
  const record = buildRecord({
    arn: "arn:aws:lambda:r:a:function:f:1",
    status: "RUNNING",
  });
  assert.equal(record.executionName, undefined);
  assert.equal(record.functionQualifier, "1");
});

test("buildRecord reads whole and fractional epoch seconds", () => {
  const record = buildRecord({
    arn: ARN,
    status: "SUCCEEDED",
    emittedAt: new Date("2026-01-01T00:01:00.000Z"),
    operations: [
      {
        Id: "e",
        Type: "EXECUTION",
        Status: "STARTED",
        StartTimestamp: 1_767_225_600,
      },
      {
        Id: "1",
        Name: "num",
        Type: "STEP",
        SubType: "Step",
        Status: "SUCCEEDED",
        StartTimestamp: 1_767_225_600.123,
        EndTimestamp: 1_767_225_601.5,
        StepDetails: { Attempt: 2 },
      },
      {
        Id: "2",
        Name: "frac",
        Type: "WAIT",
        Status: "SUCCEEDED",
        StartTimestamp: 1_767_225_600.25,
        EndTimestamp: 1_767_225_602,
      },
      { Id: "3", Name: "open", Type: "CALLBACK", Status: "STARTED" },
      { Id: "4", Name: "bad", Type: "STEP" },
    ],
  });
  assert.equal(record.startTime, "2026-01-01T00:00:00.000Z");
  assert.equal(record.endTime, "2026-01-01T00:01:00.000Z");
  assert.equal(record.durationMs, 60_000);
  const [num, frac, open, bad] = record.operations;
  assert.deepEqual(num, {
    id: "1",
    name: "num",
    type: "STEP",
    subType: "Step",
    parentId: undefined,
    status: "SUCCEEDED",
    startTime: "2026-01-01T00:00:00.123Z",
    endTime: "2026-01-01T00:00:01.500Z",
    durationMs: 1377,
    attempt: 2,
    error: undefined,
  });
  assert.equal(frac.startTime, "2026-01-01T00:00:00.250Z");
  assert.equal(frac.durationMs, 1750);
  assert.equal(open.endTime, undefined);
  assert.equal(open.durationMs, undefined);
  assert.equal(bad.startTime, undefined);
  assert.equal(bad.status, "UNKNOWN");
});

test("buildRecord maps statuses and errors", () => {
  const status = (s) => buildRecord({ arn: ARN, status: s }).status;
  assert.equal(status("SUCCEEDED"), "SUCCEEDED");
  assert.equal(status("FAILED"), "FAILED");
  assert.equal(status("PENDING"), "RUNNING");
  assert.equal(status("RETRYING"), "RUNNING");
  assert.equal(status("RUNNING"), "RUNNING");

  const failed = buildRecord({
    arn: ARN,
    status: "FAILED",
    error: { ErrorType: "OrderRejected", ErrorMessage: "no", ErrorData: "x" },
  });
  assert.deepEqual(failed.error, { name: "OrderRejected", message: "no" });
  const empty = buildRecord({ arn: ARN, status: "FAILED", error: {} });
  assert.deepEqual(empty.error, { name: "Error", message: "" });

  const ops = buildRecord({
    arn: ARN,
    status: "RUNNING",
    operations: [
      {
        Id: "c",
        Name: "ctx",
        Type: "CONTEXT",
        Status: "FAILED",
        ContextDetails: { Error: { ErrorType: "E1" } },
      },
    ],
  }).operations;
  assert.deepEqual(ops[0].error, { name: "E1", message: "" });
});

test("without an EXECUTION record, startTime is the current time", () => {
  const before = Date.now();
  const record = buildRecord({ arn: ARN, status: "RUNNING" });
  assert.ok(Date.parse(record.startTime) >= before);
  assert.ok(Date.parse(record.startTime) <= Date.now());
});

const bytes = (r) => Buffer.byteLength(JSON.stringify(r));

function bigRecord() {
  const operations = Array.from({ length: 20 }, (_, i) => ({
    Id: `id-${i}`,
    Name: `step-${i}`,
    Type: "STEP",
    Status: "SUCCEEDED",
    StartTimestamp: 1,
    EndTimestamp: 2,
  }));
  return buildRecord({
    arn: ARN,
    status: "SUCCEEDED",
    input: { pad: "i".repeat(1000) },
    output: { pad: "o".repeat(1000) },
    operations,
  });
}

test("fitRecord returns the same record when it fits or has no limit", () => {
  const record = bigRecord();
  assert.equal(fitRecord(record, undefined), record);
  assert.equal(fitRecord(record, bytes(record)), record);
});

test("fitRecord drops input, then output, then operations from the end", () => {
  const record = bigRecord();
  const copy = structuredClone(record);
  const full = bytes(record);

  const noInput = fitRecord(record, full - 500);
  assert.equal(noInput.truncated, true);
  assert.equal(noInput.droppedInput, true);
  assert.equal(noInput.droppedOutput, undefined);
  assert.deepEqual(noInput.output, record.output);
  assert.equal(noInput.operations.length, 20);

  const noOutput = fitRecord(record, full - 1500);
  assert.equal(noOutput.droppedInput, true);
  assert.equal(noOutput.droppedOutput, true);
  assert.equal(noOutput.droppedOperations, undefined);

  const fewer = fitRecord(record, full - 2500);
  assert.equal(fewer.droppedOutput, true);
  assert.ok(fewer.droppedOperations > 0);
  assert.equal(fewer.operations.length, 20 - fewer.droppedOperations);
  // The newest operations go first, so the oldest remain.
  assert.equal(fewer.operations[0].name, "step-0");
  assert.ok(bytes(fewer) <= full - 2500);
  // The smallest number of drops: one operation fewer would not fit.
  const oneMore = {
    ...fewer,
    operations: record.operations.slice(0, fewer.operations.length + 1),
    droppedOperations: fewer.droppedOperations - 1 || undefined,
  };
  assert.ok(bytes(oneMore) > full - 2500);

  // The record that the plugin shares between exporters is unchanged.
  assert.deepEqual(record, copy);
});

test("fitRecord returns undefined when the record cannot fit", () => {
  const record = bigRecord();
  assert.equal(fitRecord(record, 50), undefined);
  const noOps = buildRecord({ arn: ARN, status: "RUNNING" });
  assert.equal(fitRecord(noOps, 50), undefined);
});

test("fitRecord keeps every operation it can at an exact limit", () => {
  const record = bigRecord();
  for (let max = bytes(record) - 2500; max > 400; max -= 97) {
    const out = fitRecord(record, max);
    if (out === undefined) continue;
    assert.ok(bytes(out) <= max, `max ${max}`);
  }
});
