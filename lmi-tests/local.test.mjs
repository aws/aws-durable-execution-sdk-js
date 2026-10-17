// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { observer } from "./observer.mjs";

import { harness, bounded } from "./local-support.mjs";

// These are desired-behavior regressions. Run explicitly via test:lmi:regressions;
// known failures remain ordinary failures, never skips or inverted expectations.
for (const scenario of [
  "race",
  "any",
  "map",
  "parallel",
  "nested",
  "return-inflight",
  "failure-inflight",
]) {
  test(`${scenario}: no SDK writes or new step bodies after wrapper return`, async () => {
    const h = harness(scenario);
    try {
      const response = h.run();
      await bounded(h.entered.promise);
      h.gates.winner.resolve();
      const output = await bounded(response);
      assert.equal(
        output.Status,
        scenario === "failure-inflight" ? "FAILED" : "SUCCEEDED",
      );
      h.gates.loser.resolve();
      await delay(100);
      assert.deepEqual(
        {
          lateWrites: h.calls
            .filter((call) => call.closed)
            .flatMap((call) => call.Updates),
          newBodies: h.events.filter((e) => e.operation === "late-operation"),
        },
        { lateWrites: [], newBodies: [] },
      );
    } finally {
      h.release();
    }
  });
}

test("deadline: do not admit another step after an in-flight step settles", async () => {
  const h = harness("deadline-step");
  try {
    const response = h.run();
    await bounded(h.entered.promise);
    h.expire();
    h.gates.loser.resolve();
    // Do not mandate SUCCEEDED/FAILED/PENDING for timeout: classification belongs
    // to the service contract. Admission is independently observable.
    response.catch(() => undefined);
    await delay(100);
    assert.deepEqual(
      h.events.filter((e) => e.operation === "after-deadline"),
      [],
    );
  } finally {
    h.release();
  }
});

for (const scenario of ["success", "failure", "replay"]) {
  test(`${scenario}: no SDK callbacks execute after wrapper disposal`, async () => {
    const tracker = observer();
    const state = { kind: "sdk", closed: false, lateCallbacks: 0 };
    const h = harness(scenario);
    try {
      await bounded(tracker.scope.run(state, () => h.run()));
      state.closed = true;
      await delay(650);
      assert.deepEqual(tracker.snapshot(state), {
        timers: 0,
        lateCallbacks: 0,
      });
    } finally {
      tracker.close();
      h.release();
    }
  });
}
