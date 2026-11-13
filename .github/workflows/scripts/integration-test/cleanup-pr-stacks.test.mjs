// @ts-check
//
// Unit tests for cleanup-pr-stacks.mjs. Run locally with:
//   node --test .github/workflows/scripts/integration-test/*.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cleanupClosedPullRequestStacks } from "./cleanup-pr-stacks.mjs";

/**
 * @param {object} options
 * @param {string[]} options.stacks
 * @param {Record<string, boolean>} options.closed by pull request number
 * @param {string[]} [options.startFails]
 * @param {string[]} [options.waitFails]
 */
function fakeDeps({ stacks, closed, startFails = [], waitFails = [] }) {
  /** @type {string[]} */
  const started = [];
  /** @type {string[]} */
  const looked = [];
  return {
    started,
    looked,
    deps: {
      listStacks: () => stacks,
      isClosed: async (/** @type {string} */ number) => {
        looked.push(number);
        if (!(number in closed))
          throw new Error(`GitHub returned 404 for #${number}`);
        return closed[number];
      },
      startDelete: (/** @type {string} */ stack) => {
        if (startFails.includes(stack)) throw new Error("stack is busy");
        started.push(stack);
      },
      waitForDelete: (/** @type {string} */ stack) => {
        if (waitFails.includes(stack)) throw new Error("DELETE_FAILED");
      },
      log: () => {},
    },
  };
}

const stack = (/** @type {string} */ runtime, /** @type {string} */ number) =>
  `aws-durable-execution-sdk-js-integ-${runtime}-pr-${number}`;

describe("cleanupClosedPullRequestStacks", () => {
  test("deletes stacks of closed pull requests and keeps open ones", async () => {
    const { deps, started } = fakeDeps({
      stacks: [stack("24x", "1"), stack("22x", "1"), stack("24x", "2")],
      closed: { 1: true, 2: false },
    });
    const result = await cleanupClosedPullRequestStacks(deps);
    assert.deepEqual(started, [stack("24x", "1"), stack("22x", "1")]);
    assert.deepEqual(result, { deleted: started, failed: [] });
  });

  test("never touches the shared stack or unrelated stacks", async () => {
    const { deps, started, looked } = fakeDeps({
      stacks: [
        "aws-durable-execution-sdk-js-integ-24x",
        "other-stack-pr-1",
        "aws-durable-execution-sdk-js-integ-24x-pr-1-extra",
      ],
      closed: {},
    });
    await cleanupClosedPullRequestStacks(deps);
    assert.deepEqual(started, []);
    assert.deepEqual(looked, []);
  });

  test("asks GitHub once per pull request", async () => {
    const { deps, looked } = fakeDeps({
      stacks: [stack("24x", "1"), stack("22x", "1")],
      closed: { 1: true },
    });
    await cleanupClosedPullRequestStacks(deps);
    assert.deepEqual(looked, ["1"]);
  });

  test("a GitHub API error fails before any delete", async () => {
    const { deps, started } = fakeDeps({
      stacks: [stack("24x", "1"), stack("24x", "3")],
      closed: { 1: true },
    });
    await assert.rejects(cleanupClosedPullRequestStacks(deps), /404/);
    assert.deepEqual(started, []);
  });

  test("a stack that cannot start deleting does not stop the others", async () => {
    const { deps, started } = fakeDeps({
      stacks: [stack("24x", "1"), stack("24x", "2"), stack("22x", "2")],
      closed: { 1: true, 2: true },
      startFails: [stack("24x", "1")],
    });
    const result = await cleanupClosedPullRequestStacks(deps);
    assert.deepEqual(started, [stack("24x", "2"), stack("22x", "2")]);
    assert.deepEqual(result.deleted, started);
    assert.deepEqual(result.failed, [stack("24x", "1")]);
  });

  test("a stack that fails to delete does not stop the others", async () => {
    const { deps } = fakeDeps({
      stacks: [stack("24x", "1"), stack("24x", "2")],
      closed: { 1: true, 2: true },
      waitFails: [stack("24x", "1")],
    });
    const result = await cleanupClosedPullRequestStacks(deps);
    assert.deepEqual(result.deleted, [stack("24x", "2")]);
    assert.deepEqual(result.failed, [stack("24x", "1")]);
  });
});
