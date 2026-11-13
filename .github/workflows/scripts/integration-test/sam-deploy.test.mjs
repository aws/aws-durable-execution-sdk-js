// @ts-check
//
// Unit tests for sam-deploy.mjs. Run locally with:
//   node --test .github/workflows/scripts/integration-test/*.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  deleteIfRolledBack,
  deployWithRollbackRecovery,
  retry,
  retryDelayMs,
} from "./sam-deploy.mjs";

/**
 * @param {(string | undefined)[]} statuses getStatus answers, in order
 */
function fakeStack(statuses) {
  /** @type {string[]} */
  const calls = [];
  let i = 0;
  return {
    calls,
    ops: {
      getStatus: () => {
        calls.push("status");
        return statuses[Math.min(i++, statuses.length - 1)];
      },
      deleteStack: () => {
        calls.push("delete");
      },
      waitForDelete: () => {
        calls.push("wait");
      },
      log: () => {},
      sleep: async () => {
        calls.push("sleep");
      },
    },
  };
}

/** @param {number} failures how many attempts fail before one succeeds */
function flakyDeploy(failures, /** @type {string[]} */ calls) {
  let attempt = 0;
  return () => {
    attempt++;
    calls.push(`deploy#${attempt}`);
    if (attempt <= failures) throw new Error(`deploy ${attempt} failed`);
    return "ok";
  };
}

describe("deleteIfRolledBack", () => {
  test("deletes a ROLLBACK_COMPLETE stack and waits", () => {
    const { calls, ops } = fakeStack(["ROLLBACK_COMPLETE"]);
    assert.equal(deleteIfRolledBack(ops), true);
    assert.deepEqual(calls, ["status", "delete", "wait"]);
  });

  for (const status of [
    undefined,
    "CREATE_COMPLETE",
    "UPDATE_COMPLETE",
    "UPDATE_ROLLBACK_COMPLETE",
  ]) {
    test(`leaves a stack in ${status ?? "no status (absent)"} alone`, () => {
      const { calls, ops } = fakeStack([status]);
      assert.equal(deleteIfRolledBack(ops), false);
      assert.deepEqual(calls, ["status"]);
    });
  }
});

describe("deployWithRollbackRecovery", () => {
  test("a rolled-back first create is deleted, then created again", async () => {
    const { calls, ops } = fakeStack(["ROLLBACK_COMPLETE"]);
    const result = await deployWithRollbackRecovery(flakyDeploy(1, calls), ops);
    assert.equal(result, "ok");
    assert.deepEqual(calls, [
      "deploy#1",
      "status",
      "delete",
      "wait",
      "sleep",
      "deploy#2",
    ]);
  });

  test("a failed update of a healthy stack retries without deleting", async () => {
    const { calls, ops } = fakeStack(["UPDATE_COMPLETE"]);
    await deployWithRollbackRecovery(flakyDeploy(1, calls), ops);
    assert.deepEqual(calls, ["deploy#1", "status", "sleep", "deploy#2"]);
  });

  test("a deploy that works the first time checks nothing", async () => {
    const { calls, ops } = fakeStack(["ROLLBACK_COMPLETE"]);
    await deployWithRollbackRecovery(flakyDeploy(0, calls), ops);
    assert.deepEqual(calls, ["deploy#1"]);
  });
});

describe("retry", () => {
  test("throws the last error after maxAttempts", async () => {
    /** @type {string[]} */
    const calls = [];
    await assert.rejects(
      retry(flakyDeploy(9, calls), {
        maxAttempts: 3,
        sleep: async () => {},
        log: () => {},
      }),
      /deploy 3 failed/,
    );
    assert.deepEqual(calls, ["deploy#1", "deploy#2", "deploy#3"]);
  });

  test("waits 15 s more per attempt, up to 60 s", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5].map(retryDelayMs),
      [15000, 30000, 45000, 60000, 60000],
    );
  });
});
