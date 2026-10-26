// The plugin's contract for work that settles after onInvocationEnd, and for concurrent
// invocations (README, Contributing, rule 9). The lite SDK's README states what the SDK
// guarantees: "A plugin ignores work that settles after onInvocationEnd".

import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { withDurableExecution } from "../../aws-durable-execution-sdk-js-lite/src/index.js";
import { createTelemetryPlugin } from "../src/index.js";
import { ARN, fakeExporter, runDurable } from "./helpers.js";

test("no record after onInvocationEnd, even when a losing race branch checkpoints later", async () => {
  // The workflow returns while the losing branch's step still runs. The SDK does not
  // mark the execution as done when the workflow returns. So the branch's SUCCEED
  // reaches the service, and the SDK calls onOperationChange for its response. The
  // final export is slow, so that response arrives while onInvocationEnd waits.
  const exporter = fakeExporter({
    async export(record) {
      if (record.status === "SUCCEEDED") await sleep(60);
      exporter.records.push(structuredClone(record));
    },
  });
  const result = await runDurable({
    plugins: [
      createTelemetryPlugin({ exporters: [exporter], emitMode: "on-change" }),
    ],
    workflow: ({ ctx }) =>
      ctx.runInChildContext({
        name: "race",
        fn: ({ ctx: c }) =>
          Promise.race([
            c.step({ name: "fast", fn: () => "a" }),
            c.step({ name: "slow", fn: () => sleep(20).then(() => "b") }),
          ]),
      }),
  });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.getOperation("slow").Status, "SUCCEEDED");
  await sleep(100);
  const statuses = exporter.records.map((r) => r.status);
  assert.equal(statuses.at(-1), "SUCCEEDED", statuses.join(","));
  assert.equal(statuses.filter((s) => s === "SUCCEEDED").length, 1);
});

test("no record after onInvocationEnd when a step settles after a checkpoint error", async () => {
  // A checkpoint error ends the invocation while the step "slow" runs. The SDK then
  // sends no checkpoint and calls no onOperationChange (README of the lite SDK, section
  // 2.12). So the step's later SUCCEED produces no record.
  const exporter = fakeExporter();
  const client = {
    async checkpoint() {
      throw Object.assign(new Error("unavailable"), {
        name: "ServiceException",
        status: 503,
      });
    },
    async getExecutionState() {
      return {};
    },
  };
  let settled = false;
  const handler = withDurableExecution(
    ({ ctx }) =>
      Promise.all([
        ctx.step({ name: "fast", fn: () => 1 }),
        ctx.step({
          name: "slow",
          fn: async () => {
            await sleep(30);
            settled = true;
          },
        }),
      ]),
    {
      client,
      plugins: [
        createTelemetryPlugin({ exporters: [exporter], emitMode: "on-change" }),
      ],
    },
  );
  const event = {
    DurableExecutionArn: ARN,
    CheckpointToken: "token-0",
    InitialExecutionState: {
      Operations: [
        { Id: "exec", Type: "EXECUTION", Status: "STARTED", StartTimestamp: 1 },
      ],
    },
  };
  await assert.rejects(handler(event, {}), { status: 503 });
  const count = exporter.records.length;
  await sleep(60);
  assert.equal(settled, true);
  assert.equal(exporter.records.length, count);
  // The factory's record, then the end of the retrying invocation.
  assert.deepEqual(
    exporter.records.map((r) => r.status),
    ["RUNNING", "RUNNING"],
  );
});

test("two concurrent plugin objects never mix records, and their chains are independent", async () => {
  const arnA = ARN.replace("/run", "/run-a");
  const arnB = ARN.replace("/run", "/run-b");
  // The exporter holds every record of execution A until release() is called.
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const exporter = fakeExporter({
    async export(record) {
      if (record.executionArn === arnA) await held;
      exporter.records.push(structuredClone(record));
    },
  });
  const factory = createTelemetryPlugin({
    exporters: [exporter],
    emitMode: "on-change",
  });
  const execution = { Id: "exec", Type: "EXECUTION", Status: "STARTED" };
  const step = (Id, Name) => ({
    Id,
    Name,
    Type: "STEP",
    SubType: "Step",
    Status: "SUCCEEDED",
    StartTimestamp: 1,
    EndTimestamp: 2,
  });
  const a = factory({ arn: arnA, input: { n: "a" }, operations: [execution] });
  const b = factory({ arn: arnB, input: { n: "b" }, operations: [execution] });
  assert.notEqual(a, b);

  // The hooks of the two invocations interleave, as on Lambda Managed Instances.
  const opsA = [execution, step("a1", "step-a")];
  const opsB = [execution, step("b1", "step-b")];
  a.onOperationChange({ updated: [opsA[1]], operations: opsA });
  b.onOperationChange({ updated: [opsB[1]], operations: opsB });
  const endA = a.onInvocationEnd({
    status: "SUCCEEDED",
    result: "ra",
    operations: opsA,
  });
  // B's records reach the exporter while every record of A waits.
  await b.onInvocationEnd({
    status: "SUCCEEDED",
    result: "rb",
    operations: opsB,
  });
  assert.deepEqual(
    exporter.records.map((r) => [r.executionArn, r.status]),
    [
      [arnB, "RUNNING"],
      [arnB, "RUNNING"],
      [arnB, "SUCCEEDED"],
    ],
  );
  release();
  await endA;

  for (const [arn, x] of [
    [arnA, "a"],
    [arnB, "b"],
  ]) {
    const records = exporter.records.filter((r) => r.executionArn === arn);
    assert.deepEqual(
      records.map((r) => r.status),
      ["RUNNING", "RUNNING", "SUCCEEDED"],
    );
    for (const r of records) assert.deepEqual(r.input, { n: x });
    assert.equal(records.at(-1).output, `r${x}`);
    assert.deepEqual(
      records.at(-1).operations.map((op) => op.name),
      [`step-${x}`],
    );
  }
});
