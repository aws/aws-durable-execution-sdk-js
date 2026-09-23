// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { manager, preparePoll } from "./manager-support.mjs";
import { deferred } from "./scenarios.mjs";

test("poll fixture reaches the held transport and resumes while the manager is open", {
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
  const op = preparePoll(m);
  let refresh;
  try {
    refresh = m.forceRefreshAndCheckStatus("2");
    await entered.promise;
    assert.equal(calls, 1);
    assert.equal(op.timer, undefined);
    release.resolve();
    await refresh;
    assert.ok(
      op.timer,
      "An open manager should rearm the unchanged waiting operation",
    );
  } finally {
    release.resolve();
    await refresh;
    m.dispose();
  }
});
