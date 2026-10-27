import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { CUSTOM_PAYLOAD, sizeBound } from "../src/execution.js";
import { hashId } from "../src/ids.js";
import { ARN as LOCAL_ARN } from "../../aws-durable-execution-sdk-js-lite-testing/src/in-memory-service.js";
import { runDurable } from "./helpers/run-durable.js";
import { ARN, createFakeClient, executionOp } from "./helpers/fake-client.js";
import { invoke } from "./helpers/invoke.js";

// A serdes like the README's S3 example. It stores each value in a Map under the
// execution ARN and the entity id, and saves only a pointer. It records every call.
function pointerSerdes({ delayMs = 0 } = {}) {
  const store = new Map();
  const calls = [];
  return {
    store,
    calls,
    serdes: {
      async serialize({ value, entityId, durableExecutionArn }) {
        calls.push({ op: "serialize", value, entityId, durableExecutionArn });
        if (delayMs) await sleep(delayMs);
        const key = `${durableExecutionArn}/${entityId}`;
        store.set(key, value);
        return `ptr:${key}`;
      },
      async deserialize({ data, entityId, durableExecutionArn }) {
        calls.push({ op: "deserialize", data, entityId, durableExecutionArn });
        if (delayMs) await sleep(delayMs);
        return store.get(data.slice("ptr:".length));
      },
    },
  };
}
const ops = (calls) => calls.map((c) => `${c.op}:${c.entityId}`);
// A wait forces a second invocation, which replays everything before it.
const pause = (ctx) => ctx.wait({ name: "pause", seconds: 1 });

test("step: serialize runs once in the first run, deserialize only in a replay", async () => {
  const { calls, serdes } = pointerSerdes();
  const date = new Date(0);
  const seen = [];
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const value = await ctx.step({ name: "s", fn: () => ({ date }), serdes });
      seen.push(value);
      await pause(ctx);
      return value.date instanceof Date;
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.invocations, 2);
  // The deserialized value keeps the Date, so the workflow sees a Date both times.
  assert.equal(run.result, true);
  assert.deepEqual(calls, [
    {
      op: "serialize",
      value: { date },
      entityId: "1",
      durableExecutionArn: LOCAL_ARN,
    },
    {
      op: "deserialize",
      data: `ptr:${LOCAL_ARN}/1`,
      entityId: "1",
      durableExecutionArn: LOCAL_ARN,
    },
  ]);
  // The first run returns fn's own object.
  assert.equal(seen[0].date, date);
  assert.equal(run.getOperation("s").StepDetails.Result, `ptr:${LOCAL_ARN}/1`);
});

test("step: entityId is the raw id inside a child context", async () => {
  const { calls, serdes } = pointerSerdes();
  await runDurable({
    workflow: ({ ctx }) =>
      ctx.runInChildContext({
        fn: ({ ctx: c }) => c.step({ fn: () => 1, serdes }),
      }),
  });
  assert.deepEqual(ops(calls), ["serialize:1-1"]);
});

test("step: an async serialize finishes before SUCCEED, and the invocation does not suspend meanwhile", async () => {
  const { calls, serdes } = pointerSerdes({ delayMs: 20 });
  const { output, updates } = await invoke(async ({ ctx }) => {
    // The wait blocks at once. Without the running count, the invocation would end
    // while serialize sleeps, before SUCCEED is queued.
    await Promise.all([
      pause(ctx),
      ctx.step({ name: "s", fn: () => "v", serdes }),
    ]);
  });
  assert.equal(output.Status, "PENDING");
  assert.deepEqual(ops(calls), ["serialize:2"]);
  const succeed = updates.find((u) => u.Action === "SUCCEED");
  assert.equal(succeed.Id, hashId("2"));
  assert.equal(succeed.Payload, `ptr:${ARN}/2`);
});

test("step: a sync serdes works too", async () => {
  const serdes = {
    serialize: ({ value }) => String(value * 2),
    deserialize: ({ data }) => Number(data) / 2,
  };
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const a = await ctx.step({ name: "s", fn: () => 21, serdes });
      await pause(ctx);
      return a;
    },
  });
  assert.equal(run.result, 21);
  assert.equal(run.getOperation("s").StepDetails.Result, "42");
});

test("step: undefined reaches serialize, and an undefined result means no Payload", async () => {
  const values = [];
  const serdes = {
    serialize: ({ value }) => {
      values.push(value);
      return undefined;
    },
    deserialize: ({ data }) => {
      values.push(data);
      return "from-deserialize";
    },
  };
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const a = await ctx.step({ name: "s", fn: () => undefined, serdes });
      await pause(ctx);
      return a;
    },
  });
  assert.equal(run.result, "from-deserialize");
  assert.deepEqual(values, [undefined, undefined]);
  assert.equal("Result" in run.getOperation("s").StepDetails, false);
});

test("a serialize throw throws SerdesFailedError from the Lambda handler", async () => {
  const cause = new Error("S3 unavailable");
  const serdes = {
    serialize: async () => {
      throw cause;
    },
    deserialize: () => assert.fail("not called"),
  };
  await assert.rejects(
    invoke(async ({ ctx }) => {
      await ctx.step({ name: "s", fn: () => 1, serdes });
      assert.fail("the step must not return");
    }),
    (err) => {
      assert.equal(err.name, "SerdesFailedError");
      assert.equal(err.cause, cause);
      assert.match(err.message, /Serialization failed for operation 1: S3/);
      return true;
    },
  );
});

test("after a serialize throw, Lambda invokes again and the step runs again", async () => {
  let fails = 1;
  let runs = 0;
  const serdes = {
    serialize: ({ value }) => {
      if (fails-- > 0) throw new Error("transient");
      return String(value);
    },
    deserialize: ({ data }) => Number(data),
  };
  const run = await runDurable({
    workflow: ({ ctx }) =>
      ctx.step({
        name: "s",
        fn: () => {
          runs++;
          return 7;
        },
        serdes,
      }),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, 7);
  assert.equal(run.invocations, 2);
  assert.equal(runs, 2);
});

test("a deserialize throw in a replay throws SerdesFailedError", async () => {
  const serdes = {
    serialize: () => "x",
    deserialize: () => {
      throw new Error("gone");
    },
  };
  const operations = [
    {
      ...{ Id: hashId("1"), Type: "STEP", SubType: "Step", Name: "s" },
      Status: "SUCCEEDED",
      StepDetails: { Result: "x" },
    },
  ];
  await assert.rejects(
    invoke(({ ctx }) => ctx.step({ name: "s", fn: () => 1, serdes }), {
      operations,
    }),
    { name: "SerdesFailedError", message: /Deserialization failed/ },
  );
});

test("runInChildContext: serialize once, deserialize only in a replay", async () => {
  const { calls, serdes } = pointerSerdes();
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const v = await ctx.runInChildContext({
        name: "c",
        fn: ({ ctx: c }) => c.step({ fn: () => ({ n: 1 }) }),
        serdes,
      });
      await pause(ctx);
      return v;
    },
  });
  assert.deepEqual(run.result, { n: 1 });
  assert.deepEqual(ops(calls), ["serialize:1", "deserialize:1"]);
  assert.equal(
    run.getOperation("c").ContextDetails.Result,
    `ptr:${LOCAL_ARN}/1`,
  );
});

test("runInChildContext: a serialized string over 256 KiB sets ReplayChildren", async () => {
  let serializes = 0;
  let deserializes = 0;
  const serdes = {
    // The value is small. Its serialized form is large.
    serialize: () => {
      serializes++;
      return "x".repeat(300 * 1024);
    },
    deserialize: () => {
      deserializes++;
    },
  };
  let steps = 0;
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const v = await ctx.runInChildContext({
        name: "c",
        fn: ({ ctx: c }) =>
          c.step({
            fn: () => {
              steps++;
              return "small";
            },
          }),
        serdes,
      });
      await pause(ctx);
      return v;
    },
  });
  assert.equal(run.result, "small");
  const details = run.getOperation("c").ContextDetails;
  assert.equal(details.ReplayChildren, true);
  assert.equal(details.Result, "");
  // The re-run rebuilds the value from the step's record. It calls no serdes.
  assert.equal(serializes, 1);
  assert.equal(deserializes, 0);
  assert.equal(steps, 1);
});

test("waitForCondition: serialize makes each state Payload, deserialize reads saved states", async () => {
  const { calls, serdes } = pointerSerdes();
  const states = [];
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const v = await ctx.waitForCondition({
        name: "w",
        initialState: { n: 0 },
        fn: ({ state }) => {
          states.push(state);
          return { n: state.n + 1 };
        },
        waitStrategy: ({ state }) => ({ shouldContinue: state.n < 2 }),
        serdes,
      });
      await pause(ctx);
      return v;
    },
  });
  assert.deepEqual(run.result, { n: 2 });
  // Check 1 gets initialState itself. Check 2 reads the saved state. The SUCCEEDED
  // record is read once, in the replay after the pause.
  assert.deepEqual(states, [{ n: 0 }, { n: 1 }]);
  assert.deepEqual(ops(calls), [
    "serialize:1",
    "deserialize:1",
    "serialize:1",
    "deserialize:1",
  ]);
});

test("invoke: payloadSerdes makes the Payload, resultSerdes reads the result", async () => {
  const calls = [];
  const payloadSerdes = {
    serialize: async ({ value, entityId, durableExecutionArn }) => {
      calls.push(["serialize", entityId, durableExecutionArn]);
      return JSON.stringify({ wrapped: value });
    },
  };
  const resultSerdes = {
    deserialize: async ({ data, entityId }) => {
      calls.push(["deserialize", entityId]);
      return { parsed: JSON.parse(data) };
    },
  };
  const run = await runDurable({
    workflow: ({ ctx }) =>
      ctx.invoke({
        name: "i",
        functionName: "callee",
        input: 5,
        payloadSerdes,
        resultSerdes,
      }),
    functions: { callee: ({ input }) => input.wrapped * 2 },
  });
  assert.deepEqual(run.result, { parsed: 10 });
  // The first run blocks on the invoke. The second run reads the callee's result.
  assert.deepEqual(calls, [
    ["serialize", "1", LOCAL_ARN],
    ["deserialize", "1"],
  ]);
});

test("invoke: payloadSerdes receives undefined input", async () => {
  const values = [];
  const { updates } = await invoke(({ ctx }) =>
    ctx.invoke({
      functionName: "f",
      payloadSerdes: {
        serialize: ({ value }) => {
          values.push(value);
          return "none";
        },
      },
    }),
  );
  assert.deepEqual(values, [undefined]);
  assert.equal(updates[0].Payload, "none");
});

test("createCallback: serdes.deserialize reads the raw result", async () => {
  const calls = [];
  const serdes = {
    deserialize: async ({ data, entityId, durableExecutionArn }) => {
      calls.push([data, entityId, durableExecutionArn]);
      return Number(data) + 1;
    },
  };
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const { result } = await ctx.createCallback({ name: "cb", serdes });
      return await result;
    },
    onCallback: () => ({ result: "41" }),
  });
  assert.equal(run.result, 42);
  assert.deepEqual(calls, [["41", "1", LOCAL_ARN]]);
});

test("createCallback: the default result stays the raw string", async () => {
  const run = await runDurable({
    workflow: async ({ ctx }) => (await ctx.createCallback()).result,
    onCallback: () => ({ result: "41" }),
  });
  assert.equal(run.result, "41");
});

test("waitForCallback: serdes.deserialize gets the context's raw id, in every run", async () => {
  const calls = [];
  const serdes = {
    deserialize: ({ data, entityId }) => {
      calls.push([data, entityId]);
      return JSON.parse(data);
    },
  };
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      await ctx.step({ fn: () => 0 });
      const v = await ctx.waitForCallback({
        name: "w",
        submitter: () => {},
        serdes,
      });
      await pause(ctx);
      return v;
    },
    onCallback: () => ({ result: '{"ok":true}' }),
  });
  assert.deepEqual(run.result, { ok: true });
  assert.deepEqual(calls, [
    ['{"ok":true}', "2"],
    ['{"ok":true}', "2"],
  ]);
});

test("map: itemSerdes serializes each item and a replay deserializes each item", async () => {
  const { calls, serdes } = pointerSerdes();
  const firstRun = [];
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const res = await ctx.map({
        name: "m",
        items: [1, 2],
        fn: ({ ctx: c, item }) => c.step({ fn: () => ({ item }) }),
        itemSerdes: serdes,
      });
      if (!ctx.replaying) firstRun.push(res.getResults());
      await pause(ctx);
      return res.getResults();
    },
  });
  assert.deepEqual(run.result, [{ item: 1 }, { item: 2 }]);
  assert.deepEqual(firstRun, [[{ item: 1 }, { item: 2 }]]);
  assert.deepEqual(ops(calls), [
    "serialize:1-1",
    "serialize:1-2",
    "deserialize:1-1",
    "deserialize:1-2",
  ]);
  // The batch saves only the summary, so its record holds no item value.
  const batch = run.getOperation("m").ContextDetails;
  assert.equal(batch.ReplayChildren, true);
  assert.deepEqual(JSON.parse(batch.Result), {
    completionReason: "ALL_COMPLETED",
    itemStatuses: "SS",
  });
  const item = run.operations.find((o) => o.Id === hashId("1-1"));
  assert.equal(item.ContextDetails.Result, `ptr:${LOCAL_ARN}/1-1`);
});

test("parallel: itemSerdes applies to each branch", async () => {
  const { calls, serdes } = pointerSerdes();
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const res = await ctx.parallel({
        name: "p",
        branches: [{ fn: () => "a" }, { fn: () => "b" }],
        itemSerdes: serdes,
      });
      await pause(ctx);
      return res.getResults();
    },
  });
  assert.deepEqual(run.result, ["a", "b"]);
  assert.deepEqual(ops(calls), [
    "serialize:1-1",
    "serialize:1-2",
    "deserialize:1-1",
    "deserialize:1-2",
  ]);
});

test("sizeBound stays an upper bound for a custom Payload with control characters", () => {
  const payloads = [
    "\u0000".repeat(1000),
    '\u0001\u001f\n\t"\\'.repeat(200),
    "\ud800".repeat(100), // lone surrogates escape to 6 bytes each
    "漢😀é".repeat(100),
  ];
  for (const Payload of payloads) {
    const u = {
      Id: "0123456789abcdef",
      Type: "STEP",
      Action: "SUCCEED",
      Payload,
      [CUSTOM_PAYLOAD]: true,
    };
    const real = Buffer.byteLength(JSON.stringify(u)) + 1;
    assert.ok(sizeBound(u) >= real, `${sizeBound(u)} < ${real}`);
  }
  // Without the mark, the JSON-text bound is too small for control characters.
  const u = { Id: "x", Payload: "\u0000".repeat(1000) };
  assert.ok(sizeBound(u) < Buffer.byteLength(JSON.stringify(u)));
});

test("only a custom Payload is marked for sizeBound, and the mark is not sent", async () => {
  const client = createFakeClient({ operations: [executionOp()] });
  const raw = [];
  const checkpoint = client.checkpoint;
  client.checkpoint = (request) => {
    raw.push(...request.Updates);
    return checkpoint(request);
  };
  const serdes = { serialize: () => "p", deserialize: () => {} };
  await invoke(
    async ({ ctx }) => {
      await ctx.step({ name: "custom", fn: () => 1, serdes });
      await ctx.step({ name: "default", fn: () => 1 });
    },
    { client },
  );
  const succeeds = raw.filter((u) => u.Action === "SUCCEED");
  assert.deepEqual(
    succeeds.map((u) => [u.Name, u.Payload, u[CUSTOM_PAYLOAD]]),
    [
      ["custom", "p", true],
      ["default", "1", undefined],
    ],
  );
  // JSON.stringify skips symbol keys, so the request body never holds the mark.
  assert.equal(JSON.stringify(succeeds[0]).includes("true"), false);
});
