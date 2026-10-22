import assert from "node:assert/strict";
import { test } from "node:test";
import { DurableOperationError } from "../src/errors.js";
import { hashId } from "../src/ids.js";
import { runDurable } from "../src/testing/index.js";
import { invoke } from "./helpers/invoke.js";

const invokeRecord = (Status, ChainedInvokeDetails = {}, Name) => ({
  Id: hashId("1"),
  Type: "CHAINED_INVOKE",
  SubType: "ChainedInvoke",
  ...(Name !== undefined && { Name }),
  Status,
  StartTimestamp: 1,
  ChainedInvokeDetails,
});

test("fresh invoke sends START with Payload, FunctionName and TenantId", async () => {
  const { output, updates } = await invoke(async ({ ctx }) => {
    await ctx.invoke({
      name: "charge",
      functionName: "payments:live",
      input: { amount: 5 },
      tenantId: "t-1",
    });
    assert.fail("must not continue");
  });
  assert.deepEqual(updates, [
    {
      Id: hashId("1"),
      Name: "charge",
      Type: "CHAINED_INVOKE",
      SubType: "ChainedInvoke",
      Action: "START",
      Payload: '{"amount":5}',
      ChainedInvokeOptions: { FunctionName: "payments:live", TenantId: "t-1" },
    },
  ]);
  assert.deepEqual(output, { Status: "PENDING" });
});

test("undefined input omits Payload and undefined tenantId omits TenantId", async () => {
  const { updates } = await invoke(async ({ ctx }) => {
    await ctx.invoke({ functionName: "f" });
  });
  assert.equal("Payload" in updates[0], false);
  assert.deepEqual(updates[0].ChainedInvokeOptions, { FunctionName: "f" });
});

test("SUCCEEDED returns the parsed result without a checkpoint", async () => {
  const { output, client } = await invoke(
    async ({ ctx }) => {
      const value = await ctx.invoke({ functionName: "f" });
      assert.deepEqual(value, { ok: 1 });
      return value;
    },
    { operations: [invokeRecord("SUCCEEDED", { Result: '{"ok":1}' })] },
  );
  assert.deepEqual(output, { Status: "SUCCEEDED", Result: '{"ok":1}' });
  assert.equal(client.checkpoints.length, 0);
});

test("SUCCEEDED without a Result returns undefined", async () => {
  const { output } = await invoke(
    async ({ ctx }) => {
      assert.equal(await ctx.invoke({ functionName: "f" }), undefined);
      return "ok";
    },
    { operations: [invokeRecord("SUCCEEDED")] },
  );
  assert.equal(output.Status, "SUCCEEDED");
});

for (const status of ["FAILED", "TIMED_OUT", "STOPPED"]) {
  test(`${status} throws with the callee's errorType`, async () => {
    let caught;
    const error = { ErrorType: "Boom", ErrorMessage: "m", ErrorData: "d" };
    await invoke(
      async ({ ctx }) => {
        caught = await ctx.invoke({ functionName: "f" }).catch((e) => e);
      },
      { operations: [invokeRecord(status, { Error: error })] },
    );
    assert.ok(caught instanceof DurableOperationError);
    assert.deepEqual(
      [caught.errorType, caught.message, caught.data],
      ["Boom", "m", "d"],
    );
  });
}

test("a failure without ErrorType uses InvokeError", async () => {
  const { output } = await invoke(
    ({ ctx }) => ctx.invoke({ functionName: "f" }),
    { operations: [invokeRecord("FAILED", { Error: { ErrorMessage: "m" } })] },
  );
  assert.deepEqual(output.Error, {
    ErrorType: "InvokeError",
    ErrorMessage: "m",
  });
});

test("STARTED blocks without a new START", async () => {
  const { output, client } = await invoke(
    ({ ctx }) => ctx.invoke({ functionName: "f" }),
    { operations: [invokeRecord("STARTED")] },
  );
  assert.deepEqual(output, { Status: "PENDING" });
  assert.equal(client.checkpoints.length, 0);
});

test("an invoke that replays a different operation fails the execution", async () => {
  const { output } = await invoke(
    ({ ctx }) => ctx.invoke({ name: "b", functionName: "f" }),
    { operations: [invokeRecord("STARTED", {}, "a")] },
  );
  assert.equal(output.Status, "FAILED");
  assert.equal(output.Error.ErrorType, "NonDeterministicExecutionError");
});

test("runDurable: invoke returns the callee's JSON result", async () => {
  const received = [];
  const run = await runDurable({
    input: { n: 2 },
    functions: {
      double: ({ input }) => {
        received.push(input);
        return { doubled: input.n * 2 };
      },
    },
    workflow: async ({ event, ctx }) => {
      const out = await ctx.invoke({
        name: "d",
        functionName: "double",
        input: event,
      });
      return out.doubled;
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, 4);
  assert.equal(run.invocations, 2);
  assert.deepEqual(received, [{ n: 2 }]);
  assert.equal(run.getOperation("d").Status, "SUCCEEDED");
});

test("runDurable: a callee failure keeps its error name as errorType", async () => {
  const run = await runDurable({
    functions: {
      bad: () => {
        throw new RangeError("out of range");
      },
    },
    workflow: async ({ ctx }) => {
      try {
        await ctx.invoke({ functionName: "bad" });
      } catch (err) {
        return { type: err.errorType, message: err.message };
      }
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, { type: "RangeError", message: "out of range" });
});
