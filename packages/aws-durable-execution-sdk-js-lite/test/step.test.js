import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createContext } from "../src/context.js";
import { DurableOperationError } from "../src/errors.js";
import { createExecution } from "../src/execution.js";
import { hashId } from "../src/ids.js";
import { ARN, createFakeClient, stepRecord } from "./helpers/fake-client.js";
import { invoke } from "./helpers/invoke.js";

const noRetry = () => ({ shouldRetry: false });

test("fresh step sends START and SUCCEED and returns the JSON value", async () => {
  const date = new Date(0);
  const { output, updates } = await invoke(async ({ ctx }) => {
    const value = await ctx.step({ name: "s", fn: async () => ({ date }) });
    assert.deepEqual(value, { date: date.toJSON() });
    return value;
  });
  const base = { Id: hashId("1"), Name: "s", Type: "STEP", SubType: "Step" };
  assert.deepEqual(updates, [
    { ...base, Action: "START" },
    { ...base, Action: "SUCCEED", Payload: JSON.stringify({ date }) },
  ]);
  assert.deepEqual(output, {
    Status: "SUCCEEDED",
    Result: JSON.stringify({ date }),
  });
});

test("root ids are 1, 2 and child ids use the child prefix and ParentId", async () => {
  const { updates } = await invoke(async ({ ctx }) => {
    await ctx.step({ fn: () => 1 });
    await ctx.step({ fn: () => 2 });
  });
  assert.deepEqual(
    updates.filter((u) => u.Action === "START").map((u) => u.Id),
    [hashId("1"), hashId("2")],
  );
  assert.equal("Name" in updates[0], false);
  assert.equal("ParentId" in updates[0], false);

  const client = createFakeClient();
  const execution = createExecution({
    client,
    arn: ARN,
    token: "t",
    operations: [],
  });
  const child = createContext({ execution, prefix: "3", parentId: "3" });
  await child.step({ fn: () => 1 });
  await child.step({ fn: () => 2 });
  // At-least-once steps return before their outcome is saved.
  await execution.drain();
  const ids = client.checkpoints.flatMap((r) => r.Updates);
  assert.deepEqual(
    ids.map((u) => [u.Id, u.ParentId]),
    [
      [hashId("3-1"), hashId("3")],
      [hashId("3-1"), hashId("3")],
      [hashId("3-2"), hashId("3")],
      [hashId("3-2"), hashId("3")],
    ],
  );
});

test("undefined result has no Payload and no Result", async () => {
  const { output, updates } = await invoke(async ({ ctx }) => {
    assert.equal(await ctx.step({ fn: () => undefined }), undefined);
  });
  assert.equal(updates[1].Payload, undefined);
  assert.deepEqual(output, { Status: "SUCCEEDED" });
});

test("SUCCEEDED replays the result without running fn", async () => {
  const operations = [stepRecord("1", "SUCCEEDED", { Result: '{"a":1}' })];
  const { output, client } = await invoke(
    ({ ctx }) =>
      ctx.step({
        fn: () => assert.fail("must not run"),
      }),
    { operations },
  );
  assert.deepEqual(output, { Status: "SUCCEEDED", Result: '{"a":1}' });
  assert.equal(client.checkpoints.length, 0);
});

test("FAILED replays the error without running fn", async () => {
  const errorObject = {
    ErrorType: "TypeError",
    ErrorMessage: "bad",
    ErrorData: "d",
  };
  const operations = [stepRecord("1", "FAILED", { Error: errorObject })];
  const { output } = await invoke(
    async ({ ctx }) => {
      try {
        await ctx.step({ fn: () => assert.fail("must not run") });
      } catch (err) {
        assert.ok(err instanceof DurableOperationError);
        return [err.errorType, err.message, err.data];
      }
    },
    { operations },
  );
  assert.equal(output.Result, '["TypeError","bad","d"]');
});

test("PENDING blocks and the invocation returns PENDING", async () => {
  const operations = [stepRecord("1", "PENDING", { Attempt: 1 })];
  const { output, client } = await invoke(
    ({ ctx }) => ctx.step({ fn: () => assert.fail("must not run") }),
    { operations },
  );
  assert.deepEqual(output, { Status: "PENDING" });
  assert.equal(client.checkpoints.length, 0);
});

test("READY runs fn with attempt = Attempt + 1 and sends START", async () => {
  const operations = [stepRecord("1", "READY", { Attempt: 2 })];
  const { output, updates } = await invoke(
    ({ ctx }) => ctx.step({ fn: ({ attempt }) => attempt }),
    { operations },
  );
  assert.deepEqual(
    updates.map((u) => u.Action),
    ["START", "SUCCEED"],
  );
  assert.equal(output.Result, "3");
});

test("STARTED at-least-once runs fn again without a new START", async () => {
  const operations = [stepRecord("1", "STARTED", { Attempt: 1 })];
  const { output, updates } = await invoke(
    ({ ctx }) => ctx.step({ fn: ({ attempt }) => attempt }),
    { operations },
  );
  assert.deepEqual(
    updates.map((u) => u.Action),
    ["SUCCEED"],
  );
  assert.equal(output.Result, "2");
});

test("STARTED at-most-once is interrupted: retry decision without running fn", async () => {
  const operations = [stepRecord("1", "STARTED")];
  let seen;
  const { output, updates } = await invoke(
    ({ ctx }) =>
      ctx.step({
        semantics: "AT_MOST_ONCE_PER_RETRY",
        fn: () => assert.fail("must not run"),
        retryStrategy: ({ error, attempt }) => {
          seen = [error.name, attempt];
          return { shouldRetry: true, delaySeconds: 3 };
        },
      }),
    { operations },
  );
  assert.deepEqual(seen, ["StepInterruptedError", 1]);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].Action, "RETRY");
  assert.equal(updates[0].Error.ErrorType, "StepInterruptedError");
  assert.deepEqual(updates[0].StepOptions, { NextAttemptDelaySeconds: 3 });
  assert.deepEqual(output, { Status: "PENDING" });
});

test("STARTED at-most-once without retry sends FAIL and throws", async () => {
  const operations = [stepRecord("1", "STARTED")];
  const { output, updates } = await invoke(
    ({ ctx }) =>
      ctx.step({
        semantics: "AT_MOST_ONCE_PER_RETRY",
        fn: () => assert.fail("must not run"),
        retryStrategy: noRetry,
      }),
    { operations },
  );
  assert.deepEqual(
    updates.map((u) => u.Action),
    ["FAIL"],
  );
  assert.equal(output.Status, "FAILED");
  assert.equal(output.Error.ErrorType, "StepInterruptedError");
});

test("at-most-once awaits START before fn; at-least-once does not", async () => {
  for (const semantics of [
    "AT_MOST_ONCE_PER_RETRY",
    "AT_LEAST_ONCE_PER_RETRY",
  ]) {
    const client = createFakeClient();
    const release = client.hold();
    let ran = false;
    const done = invoke(
      ({ ctx }) =>
        ctx.step({
          semantics,
          fn: () => {
            ran = true;
          },
        }),
      { client },
    );
    await sleep(5);
    assert.equal(client.checkpoints.length, 1);
    assert.equal(ran, semantics === "AT_LEAST_ONCE_PER_RETRY", semantics);
    release();
    assert.equal((await done).output.Status, "SUCCEEDED");
    assert.equal(ran, true);
  }
});

test("at-least-once returns before SUCCEED and FAIL are saved; at-most-once waits", async () => {
  for (const semantics of [
    "AT_LEAST_ONCE_PER_RETRY",
    "AT_MOST_ONCE_PER_RETRY",
  ]) {
    for (const fails of [false, true]) {
      const client = createFakeClient();
      const execution = createExecution({
        client,
        arn: ARN,
        token: "token-0",
        operations: [],
      });
      const ctx = createContext({ execution });
      let settled = false;
      // The first request (START) succeeds. Later requests are held.
      client.script(() => {
        client.hold();
        return {
          CheckpointToken: "token-1",
          NewExecutionState: { Operations: [] },
        };
      });
      const p = ctx
        .step({
          semantics,
          retryStrategy: noRetry,
          // The delay lets START go in its own request first.
          fn: async () => {
            await sleep(5);
            if (fails) throw new Error("x");
            return 1;
          },
        })
        .then(
          () => {},
          () => {},
        )
        .finally(() => {
          settled = true;
        });
      await sleep(20);
      const label = `${semantics} fails=${fails}`;
      const last = client.checkpoints.at(-1).Updates.at(-1).Action;
      assert.equal(last, fails ? "FAIL" : "SUCCEED", label);
      // The outcome request is held, so only at-least-once has returned.
      assert.equal(settled, semantics === "AT_LEAST_ONCE_PER_RETRY", label);
      void p;
    }
  }
});

test("a step does not run fn after the invocation ended", async () => {
  const client = createFakeClient();
  const execution = createExecution({
    client,
    arn: ARN,
    token: "token-0",
    operations: [],
  });
  const ctx = createContext({ execution });
  execution.fail(new Error("ended"));
  let ran = false;
  void ctx.step({
    fn: () => {
      ran = true;
    },
  });
  await sleep(10);
  assert.equal(ran, false);
});

test("failure with retry sends RETRY and suspends", async () => {
  let seen;
  const { output, updates } = await invoke(({ ctx }) =>
    ctx.step({
      name: "s",
      fn: () => {
        throw new TypeError("bad");
      },
      retryStrategy: ({ error, attempt }) => {
        seen = [error.message, attempt];
        return { shouldRetry: true };
      },
    }),
  );
  assert.deepEqual(seen, ["bad", 1]);
  assert.deepEqual(updates[1], {
    Id: hashId("1"),
    Name: "s",
    Type: "STEP",
    SubType: "Step",
    Action: "RETRY",
    Error: { ErrorType: "TypeError", ErrorMessage: "bad" },
    StepOptions: { NextAttemptDelaySeconds: 1 },
  });
  assert.deepEqual(output, { Status: "PENDING" });
});

test("failure without retry sends FAIL and throws the checkpointed error", async () => {
  const { output, updates } = await invoke(async ({ ctx }) => {
    try {
      await ctx.step({
        fn: () => {
          throw new RangeError("out");
        },
        retryStrategy: noRetry,
      });
    } catch (err) {
      assert.ok(err instanceof DurableOperationError);
      return [err.errorType, err.message];
    }
  });
  assert.equal(updates[1].Action, "FAIL");
  assert.deepEqual(updates[1].Error, {
    ErrorType: "RangeError",
    ErrorMessage: "out",
  });
  assert.equal(output.Result, '["RangeError","out"]');
});

test("default retry strategy retries the first failure", async () => {
  const { updates } = await invoke(({ ctx }) =>
    ctx.step({
      fn: () => {
        throw new Error("x");
      },
    }),
  );
  assert.equal(updates[1].Action, "RETRY");
  const delay = updates[1].StepOptions.NextAttemptDelaySeconds;
  assert.ok(delay >= 1 && delay <= 5);
});

test("a running step prevents suspension of a blocked one", async () => {
  const { output, updates } = await invoke(({ ctx }) =>
    Promise.all([
      ctx.step({
        fn: () => {
          throw new Error("x");
        },
        retryStrategy: () => ({ shouldRetry: true }),
      }),
      ctx.step({
        fn: async () => {
          await sleep(30);
          return "slow";
        },
      }),
    ]),
  );
  assert.deepEqual(output, { Status: "PENDING" });
  const last = updates.at(-1);
  assert.deepEqual(
    [last.Id, last.Action, last.Payload],
    [hashId("2"), "SUCCEED", '"slow"'],
  );
});

test("replay mismatch fails with NonDeterministicExecutionError", async () => {
  for (const record of [
    stepRecord("1", "SUCCEEDED", { name: "a", Result: "1" }),
    { ...stepRecord("1", "SUCCEEDED", { Result: "1" }), Type: "WAIT" },
    { ...stepRecord("1", "SUCCEEDED", { Result: "1" }), SubType: "Other" },
  ]) {
    const { output, client } = await invoke(
      ({ ctx }) => ctx.step({ fn: () => 1 }),
      { operations: [record] },
    );
    assert.equal(output.Status, "FAILED");
    assert.equal(output.Error.ErrorType, "NonDeterministicExecutionError");
    assert.equal(client.checkpoints.length, 0);
  }
});

test("ctx.logger is silent while replaying; the step logger never is", async (t) => {
  const info = t.mock.method(console, "info", () => {});
  const operations = [
    stepRecord("1", "SUCCEEDED", { Result: "1" }),
    stepRecord("2", "STARTED"),
  ];
  await invoke(
    async ({ ctx }) => {
      ctx.logger.info("before");
      await ctx.step({ fn: () => 1 });
      ctx.logger.info("replayed");
      await ctx.step({ fn: ({ logger }) => logger.info("in step") });
      ctx.logger.info("still replaying");
      await ctx.step({ fn: () => 3 });
      ctx.logger.info("new");
    },
    { operations },
  );
  assert.deepEqual(
    info.mock.calls.map((c) => c.arguments[0]),
    ["in step", "new"],
  );
});
