// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { invocation, harness, bounded } from "./local-support.mjs";
import { deferred } from "./scenarios.mjs";
import { observer } from "./observer.mjs";

test("two overlapping roots share one wrapper but keep tokens and results separate", async () => {
  const gates = { first: deferred(), second: deferred() };
  const entered = { first: deferred(), second: deferred() };
  const calls = [];
  const handler = withDurableExecution(
    async ({ marker }, ctx) => {
      await ctx.step("held", async () => {
        entered[marker].resolve();
        await gates[marker].promise;
      });
      return ctx.step("result", async () => marker);
    },
    {
      durableExecutionClient: {
        async getExecutionState() {
          return { Operations: [] };
        },
        async checkpoint(request) {
          calls.push(request);
          return { CheckpointToken: request.CheckpointToken };
        },
      },
    },
  );
  const start = (marker) =>
    handler(invocation("barrier", { marker }), {
      awsRequestId: marker,
      getRemainingTimeInMillis: () => 60000,
    });
  try {
    const first = start("first"),
      second = start("second");
    await bounded(Promise.all(Object.values(entered).map((e) => e.promise)));
    gates.first.resolve();
    assert.equal((await bounded(first)).Result, '"first"');
    gates.second.resolve();
    assert.equal((await bounded(second)).Result, '"second"');
    assert(calls.length > 0);
    for (const call of calls)
      assert(call.DurableExecutionArn.includes(call.CheckpointToken.slice(6)));
  } finally {
    for (const gate of Object.values(gates)) gate.resolve();
  }
});

test("suspension and replay skip successful/failed bodies without compensating", async () => {
  const h = harness("replay");
  assert.equal((await bounded(h.run())).Status, "PENDING");
  assert.equal(
    h.events.some(
      (e) => e.phase === "WAIT_FINALLY" || e.phase === "COMPENSATION",
    ),
    false,
  );
  const operations = new Map();
  for (const call of h.calls)
    for (const update of call.Updates) {
      if (
        update.Type === "STEP" &&
        ["SUCCEED", "FAIL"].includes(update.Action)
      ) {
        operations.set(update.Id, {
          Id: update.Id,
          Name: update.Name,
          Type: update.Type,
          SubType: update.SubType,
          Status: update.Action === "SUCCEED" ? "SUCCEEDED" : "FAILED",
          StepDetails:
            update.Action === "SUCCEED"
              ? { Result: update.Payload }
              : { Error: update.Error },
        });
      }
      if (update.Type === "WAIT")
        operations.set(update.Id, {
          Id: update.Id,
          Name: update.Name,
          Type: "WAIT",
          SubType: update.SubType,
          Status: "SUCCEEDED",
        });
    }
  const output = await bounded(
    h.run(invocation("replay", { operations: [...operations.values()] })),
  );
  assert.equal(output.Status, "SUCCEEDED", JSON.stringify(output));
  assert.equal(output.Result, '"replay"');
  for (const operation of ["success", "stored-failure", "after-wait"]) {
    assert.equal(
      h.events.filter((e) => e.phase === "BODY" && e.operation === operation)
        .length,
      1,
    );
  }
  const failures = h.events
    .filter((e) => e.phase === "STORED_FAILURE")
    .map((e) => e.message);
  assert.equal(failures.length, 2);
  assert.equal(new Set(failures).size, 1);
});

test("nested map and parallel make progress at maxConcurrency 1", async () => {
  const h = harness("nested-progress");
  h.gates.peer.resolve();
  const response = await bounded(h.run());
  assert.equal(response.Status, "SUCCEEDED");
  assert.deepEqual(JSON.parse(response.Result), [
    [1, 10],
    [2, 20],
  ]);
});

test("resource observer distinguishes SDK callbacks from fixture timers", async () => {
  const tracker = observer();
  const state = { kind: "sdk", closed: false, lateCallbacks: 0 };
  try {
    tracker.scope.run(state, () => {
      const cleared = setTimeout(() => assert.fail("Cleared callback ran"), 10);
      clearTimeout(cleared);
      setTimeout(() => undefined, 10);
      tracker.outside(() => setTimeout(() => undefined, 10));
    });
    state.closed = true;
    await delay(30);
    assert.deepEqual(tracker.snapshot(state), { timers: 0, lateCallbacks: 1 });
  } finally {
    tracker.close();
  }
});

test("winner cannot finish before loser entry and explicit driver release", async () => {
  const h = harness("race");
  const result = h.run();
  try {
    await bounded(h.entered.promise);
    await delay(20);
    assert.equal(
      h.events.some((e) => e.phase === "WINNER_SELECTED"),
      false,
    );
    h.gates.winner.resolve();
    assert.equal((await bounded(result)).Status, "SUCCEEDED");
    assert.equal(
      h.events.some((e) => e.operation === "loser-effect"),
      false,
    );
  } finally {
    h.release();
    await delay(50);
  }
});
