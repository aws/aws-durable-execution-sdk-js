// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { deferred } from "./scenarios.mjs";
import { manager, preparePoll } from "./manager-support.mjs";

const update = {
  Type: "STEP",
  Action: "SUCCEED",
  Name: "work",
  Payload: '"done"',
};

test("dispose is idempotent; checkpoint and force cannot send; live manager still works", async () => {
  const calls = [];
  const client = {
    async checkpoint(request) {
      calls.push(request);
      return {};
    },
  };
  const closed = manager(client),
    live = manager(client, "live");
  try {
    closed.dispose();
    closed.dispose();
    closed.checkpoint("1", update).catch(() => undefined);
    await delay(30);
    closed.forceCheckpoint().catch(() => undefined);
    await delay(30);
    await live.checkpoint("1", update);
    assert.deepEqual(
      calls.map((call) => call.CheckpointToken),
      ["live"],
    );
  } finally {
    closed.dispose();
    live.dispose();
  }
});

test("queued immediate cannot issue a request after dispose", async () => {
  const calls = [];
  const m = manager({
    async checkpoint(request) {
      calls.push(request);
      return {};
    },
  });
  m.checkpoint("1", update).catch(() => undefined);
  m.dispose();
  await delay(30);
  assert.deepEqual(calls, []);
});

test("in-flight refresh cannot rearm polling after dispose", {
  timeout: 5000,
}, async () => {
  const entered = deferred(),
    release = deferred();
  let calls = 0;
  const m = manager({
    async checkpoint() {
      calls++;
      entered.resolve();
      await release.promise;
      return {};
    },
  });
  // A still-executing sibling prevents suspension while this callback is in flight.
  const op = preparePoll(m);
  try {
    const refresh = m.forceRefreshAndCheckStatus("2");
    await entered.promise;
    m.dispose();
    release.resolve();
    await refresh;
    assert.equal(
      op.timer,
      undefined,
      "Disposed poll callback rearmed a timer after I/O",
    );
    assert.equal(calls, 1);
  } finally {
    release.resolve();
    // Test teardown clears an observed leaked timer; never conceal it in assertions.
    if (op.timer) clearTimeout(op.timer);
    m.dispose();
  }
});
