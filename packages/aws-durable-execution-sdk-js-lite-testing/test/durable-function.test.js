import assert from "node:assert/strict";
import { test } from "node:test";
import { durableFunction } from "../src/index.js";
import { runDurable, withDurableExecution } from "./helpers.js";

const child = (workflow, options) =>
  durableFunction(
    (client) => withDurableExecution(workflow, { client }),
    options,
  );

const parent = async ({ ctx }) =>
  ctx.invoke({ name: "call", functionName: "child", input: { n: 2 } });

test("a durable child runs as its own execution and returns its result", async () => {
  const run = await runDurable({
    workflow: parent,
    functions: {
      child: child(async ({ event, ctx }) => {
        await ctx.wait({ seconds: 5 });
        return ctx.step({ name: "double", fn: () => event.n * 2 });
      }),
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, 4);
  // The child's operations live in the child's service, not in the parent's.
  assert.equal(run.getOperation("double"), undefined);
  assert.equal(run.getOperation("call").Status, "SUCCEEDED");
});

test("a FAILED child fails the invoke with its ErrorType and ErrorMessage", async () => {
  const run = await runDurable({
    workflow: parent,
    functions: {
      child: child(async () => {
        throw new RangeError("too big");
      }),
    },
  });
  assert.equal(run.status, "FAILED");
  const { Error: error } = run.getOperation("call").ChainedInvokeDetails;
  assert.equal(error.ErrorType, "RangeError");
  assert.equal(error.ErrorMessage, "too big");
});

test("options reach the child, and a PENDING child fails the invoke", async () => {
  const waitForApproval = async ({ ctx }) =>
    ctx.waitForCallback({ submitter: () => {} });
  const approved = await runDurable({
    workflow: parent,
    functions: {
      child: child(waitForApproval, { onCallback: () => ({ result: "ok" }) }),
    },
  });
  assert.equal(approved.result, "ok");

  const open = await runDurable({
    workflow: parent,
    functions: { child: child(waitForApproval) },
  });
  assert.equal(open.status, "FAILED");
  assert.equal(
    open.getOperation("call").ChainedInvokeDetails.Error.ErrorMessage,
    "PENDING",
  );
});
