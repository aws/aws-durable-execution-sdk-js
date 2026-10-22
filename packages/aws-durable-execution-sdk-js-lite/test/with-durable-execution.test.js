import assert from "node:assert/strict";
import { test } from "node:test";
import { withDurableExecution } from "../src/index.js";
import {
  ARN,
  createFakeClient,
  event,
  executionOp,
  httpError,
  stepRecord,
} from "./helpers/fake-client.js";
import { invoke } from "./helpers/invoke.js";

test("passes the parsed input, ctx and lambdaContext to the handler", async () => {
  const lambdaContext = { awsRequestId: "r" };
  const client = createFakeClient();
  let args;
  const output = await withDurableExecution(
    (a) => {
      args = a;
      return { ok: true };
    },
    { client },
  )(event([], { input: { n: 1 } }), lambdaContext);
  assert.deepEqual(args.event, { n: 1 });
  assert.equal(args.lambdaContext, lambdaContext);
  assert.equal(typeof args.ctx.step, "function");
  assert.equal(args.ctx.replaying, false);
  assert.deepEqual(output, { Status: "SUCCEEDED", Result: '{"ok":true}' });
});

test("empty InputPayload gives {}", async () => {
  const { output } = await invoke(({ event }) => event);
  assert.deepEqual(output, { Status: "SUCCEEDED", Result: "{}" });
});

test("undefined result has no Result", async () => {
  const { output } = await invoke(() => undefined);
  assert.deepEqual(output, { Status: "SUCCEEDED" });
});

test("a thrown error returns FAILED with ErrorType = error name", async () => {
  const { output } = await invoke(() => {
    throw new TypeError("nope");
  });
  assert.deepEqual(output, {
    Status: "FAILED",
    Error: { ErrorType: "TypeError", ErrorMessage: "nope" },
  });
});

test("pending checkpoints are saved before the handler result is returned", async () => {
  const { output, updates } = await invoke(({ ctx }) => {
    // Not awaited: the START must still reach the service before SUCCEEDED.
    ctx.step({ fn: () => new Promise(() => {}) });
    return "done";
  });
  assert.equal(output.Status, "SUCCEEDED");
  assert.deepEqual(
    updates.map((u) => u.Action),
    ["START"],
  );
});

test("pending checkpoints are saved before a thrown error is returned", async () => {
  const { output, updates } = await invoke(async ({ ctx }) => {
    ctx.step({ fn: () => new Promise(() => {}) });
    throw new Error("x");
  });
  assert.equal(output.Status, "FAILED");
  assert.equal(updates.length, 1);
});

test("a result over 6 MB is checkpointed and Result is empty", async (t) => {
  t.mock.method(Date, "now", () => 0);
  const client = createFakeClient();
  client.script({}); // The service returns no token after the EXECUTION update.
  const big = "x".repeat(6 * 1024 * 1024);
  const { output, updates } = await invoke(() => big, { client });
  assert.deepEqual(output, { Status: "SUCCEEDED", Result: "" });
  assert.deepEqual(updates, [
    {
      Id: "f2e945f608594c90", // hashId("execution-result-0")
      Type: "EXECUTION",
      Action: "SUCCEED",
      Payload: JSON.stringify(big),
    },
  ]);
});

test("loads remaining state pages before running the handler", async () => {
  const client = createFakeClient({
    pages: [
      {
        Operations: [stepRecord("1", "SUCCEEDED", { Result: '"one"' })],
        NextMarker: "m2",
      },
      { Operations: [stepRecord("2", "SUCCEEDED", { Result: '"two"' })] },
    ],
  });
  const output = await withDurableExecution(
    async ({ ctx }) => [
      await ctx.step({ fn: () => assert.fail() }),
      await ctx.step({ fn: () => assert.fail() }),
    ],
    { client },
  )(event([], { NextMarker: "m1" }), {});
  assert.deepEqual(output, { Status: "SUCCEEDED", Result: '["one","two"]' });
  assert.deepEqual(client.stateRequests, [
    {
      DurableExecutionArn: ARN,
      CheckpointToken: "token-0",
      Marker: "m1",
      MaxItems: 1000,
    },
    {
      DurableExecutionArn: ARN,
      CheckpointToken: "token-0",
      Marker: "m2",
      MaxItems: 1000,
    },
  ]);
});

test("missing ARN or token throws", async () => {
  const handler = withDurableExecution(() => 1, { client: createFakeClient() });
  await assert.rejects(
    handler({ CheckpointToken: "t" }, {}),
    /Unexpected payload/,
  );
  await assert.rejects(
    handler({ DurableExecutionArn: ARN }, {}),
    /Unexpected payload/,
  );
});

test("checkpoint failures map to FAILED or a thrown error", async () => {
  const cases = [
    [httpError(400, "ValidationException", "bad"), "failed"],
    [httpError(502, "KMSAccessDeniedException"), "failed"],
    [
      httpError(
        400,
        "InvalidParameterValueException",
        "Invalid checkpoint token",
      ),
      "throw",
    ],
    [httpError(500, "ServiceException"), "throw"],
  ];
  for (const [err, kind] of cases) {
    const client = createFakeClient({ operations: [executionOp()] });
    client.script(err);
    const run = invoke(({ ctx }) => ctx.step({ fn: () => 1 }), { client });
    if (kind === "throw") {
      await assert.rejects(run, (e) => e === err);
    } else {
      const { output } = await run;
      assert.deepEqual(output, {
        Status: "FAILED",
        Error: { ErrorType: err.name, ErrorMessage: err.message },
      });
    }
  }
});

test("a checkpoint failure while draining after the handler is classified", async () => {
  const client = createFakeClient();
  const err = httpError(503, "ServiceException");
  client.script(err);
  const run = invoke(
    ({ ctx }) => {
      ctx.step({ fn: () => new Promise(() => {}) });
      return "done";
    },
    { client },
  );
  await assert.rejects(run, (e) => e === err);
});

test("a revoked token returns PENDING", async () => {
  const client = createFakeClient();
  client.script({ NewExecutionState: {} });
  const { output } = await invoke(({ ctx }) => ctx.step({ fn: () => 1 }), {
    client,
  });
  assert.deepEqual(output, { Status: "PENDING" });
});

test("root ctx starts replaying when the state has more than the EXECUTION op", async () => {
  const seen = [];
  await invoke(({ ctx }) => seen.push(ctx.replaying));
  await invoke(({ ctx }) => seen.push(ctx.replaying), {
    operations: [stepRecord("1", "SUCCEEDED", { Result: "1" })],
  });
  assert.deepEqual(seen, [false, true]);
});
