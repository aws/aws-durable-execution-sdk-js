import assert from "node:assert/strict";
import { test } from "node:test";
import { DurableOperationError } from "../src/errors.js";
import { hashId } from "../src/ids.js";
import { createRetryStrategy } from "../src/retry.js";
import { runDurable } from "../src/testing/index.js";

const byId = (run, rawId) =>
  run.operations.find((op) => op.Id === hashId(rawId));
const catchType = (p) =>
  p.then(
    () => "no error",
    (err) => {
      assert.ok(err instanceof DurableOperationError);
      return err.errorType;
    },
  );

test("waitForCallback resolves to the raw string; the submitter runs once", async () => {
  const submitted = [];
  const run = await runDurable({
    workflow: async ({ ctx }) =>
      ctx.waitForCallback({
        name: "approval",
        timeoutSeconds: 60,
        submitter: ({ callbackId, logger }) => {
          assert.equal(typeof logger.info, "function");
          submitted.push(callbackId);
        },
      }),
    onCallback: ({ callbackId }) => ({ result: `{"id":"${callbackId}"}` }),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, '{"id":"callback-1"}');
  assert.deepEqual(submitted, ["callback-1"]);
  assert.equal(run.invocations, 2);

  const context = byId(run, "1");
  assert.equal(context.Type, "CONTEXT");
  assert.equal(context.SubType, "WaitForCallback");
  assert.equal(context.Name, "approval");
  const callback = byId(run, "1-1");
  assert.equal(callback.Type, "CALLBACK");
  assert.equal(callback.ParentId, hashId("1"));
  assert.equal(callback.Name, undefined);
  const submitter = byId(run, "1-2");
  assert.equal(submitter.Type, "STEP");
  assert.equal(submitter.ParentId, hashId("1"));
  assert.equal(submitter.Name, undefined);
});

test("a completed waitForCallback does not run its children again", async () => {
  let submits = 0;
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const value = await ctx.waitForCallback({
        submitter: () => {
          submits++;
        },
      });
      await ctx.wait({ seconds: 1 });
      return value;
    },
    onCallback: () => ({ result: "done" }),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, "done");
  assert.equal(run.invocations, 3);
  assert.equal(submits, 1);
});

test("a timed-out callback throws CallbackTimeoutError", async () => {
  const run = await runDurable({
    workflow: async ({ ctx }) =>
      catchType(
        ctx.waitForCallback({ timeoutSeconds: 10, submitter: () => {} }),
      ),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, "CallbackTimeoutError");
  assert.equal(byId(run, "1").Status, "FAILED");
});

test("a failed callback keeps the sender's errorType", async () => {
  const run = await runDurable({
    workflow: async ({ ctx }) =>
      catchType(ctx.waitForCallback({ submitter: () => {} })),
    onCallback: () => ({ error: { ErrorType: "Denied", ErrorMessage: "no" } }),
  });
  assert.equal(run.result, "Denied");
});

test("a submitter that exhausts its retries fails with its own errorType", async () => {
  class SubmitError extends Error {
    name = "SubmitError";
  }
  let submits = 0;
  const run = await runDurable({
    workflow: async ({ ctx }) =>
      ctx.waitForCallback({
        submitter: () => {
          submits++;
          throw new SubmitError("queue down");
        },
        retryStrategy: createRetryStrategy({
          maxAttempts: 2,
          initialDelaySeconds: 1,
          jitter: false,
        }),
      }),
  });
  assert.equal(run.status, "FAILED");
  assert.equal(run.error.ErrorType, "SubmitError");
  assert.equal(run.error.ErrorMessage, "queue down");
  assert.equal(submits, 2);
  assert.equal(byId(run, "1-2").StepDetails.Attempt, 2);
});
