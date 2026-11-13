// @ts-check
//
// Unit tests for cleanup-pr-stacks.mjs. Run locally with:
//   node --test .github/workflows/scripts/integration-test/*.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  awsCli,
  cleanupClosedPullRequestStacks,
  gitHubIsClosed,
} from "./cleanup-pr-stacks.mjs";

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
  /** @type {string[]} */
  const waited = [];
  return {
    started,
    looked,
    waited,
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
        waited.push(stack);
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
    const deleted = await cleanupClosedPullRequestStacks(deps);
    assert.deepEqual(started, [stack("24x", "1"), stack("22x", "1")]);
    assert.deepEqual(deleted, started);
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

  test("a stack that cannot start deleting does not stop the others, then fails the run", async () => {
    const { deps, started, waited } = fakeDeps({
      stacks: [stack("24x", "1"), stack("24x", "2"), stack("22x", "2")],
      closed: { 1: true, 2: true },
      startFails: [stack("24x", "1")],
    });
    await assert.rejects(
      cleanupClosedPullRequestStacks(deps),
      new Error(`Could not delete 1 stack(s): ${stack("24x", "1")}`),
    );
    assert.deepEqual(started, [stack("24x", "2"), stack("22x", "2")]);
    assert.deepEqual(waited, started);
  });

  test("a stack that fails to delete does not stop the others, then fails the run", async () => {
    const { deps, waited } = fakeDeps({
      stacks: [stack("24x", "1"), stack("24x", "2")],
      closed: { 1: true, 2: true },
      waitFails: [stack("24x", "1")],
    });
    await assert.rejects(
      cleanupClosedPullRequestStacks(deps),
      new Error(`Could not delete 1 stack(s): ${stack("24x", "1")}`),
    );
    assert.deepEqual(waited, [stack("24x", "1"), stack("24x", "2")]);
  });
});

describe("gitHubIsClosed", () => {
  /**
   * @param {number} status
   * @param {object} [body]
   * @returns {{ fetchFn: typeof fetch, urls: string[] }}
   */
  const fakeFetch = (status, body = {}) => {
    /** @type {string[]} */
    const urls = [];
    const fetchFn = /** @type {typeof fetch} */ (
      /** @type {unknown} */ (
        async (/** @type {string} */ url) => {
          urls.push(url);
          return {
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
          };
        }
      )
    );
    return { fetchFn, urls };
  };

  test("a closed pull request is closed", async () => {
    const { fetchFn, urls } = fakeFetch(200, { state: "closed" });
    assert.equal(await gitHubIsClosed("aws/repo", "t", fetchFn)("7"), true);
    assert.deepEqual(urls, ["https://api.github.com/repos/aws/repo/pulls/7"]);
  });

  test("an open pull request is not closed", async () => {
    const { fetchFn } = fakeFetch(200, { state: "open" });
    assert.equal(await gitHubIsClosed("aws/repo", "t", fetchFn)("7"), false);
  });

  test("an API error throws instead of counting as closed", async () => {
    const { fetchFn } = fakeFetch(404);
    await assert.rejects(
      gitHubIsClosed("aws/repo", "t", fetchFn)("7"),
      /GitHub returned 404 for pull request #7/,
    );
  });
});

describe("awsCli", () => {
  /** @param {string} output */
  const record = (output) => {
    /** @type {string[][]} */
    const calls = [];
    const run = (/** @type {string} */ file, /** @type {string[]} */ args) => {
      calls.push([file, ...args]);
      return output;
    };
    return { calls, run };
  };

  test("lists stacks a first deploy left in REVIEW_IN_PROGRESS", () => {
    const { calls, run } = record('["a"]');
    assert.deepEqual(awsCli("us-west-2", run).listStacks(), ["a"]);
    const args = calls[0];
    const filter = args.slice(
      args.indexOf("--stack-status-filter") + 1,
      args.indexOf("--query"),
    );
    assert.ok(filter.includes("REVIEW_IN_PROGRESS"));
  });

  test("skips the other in-progress statuses, which reject DeleteStack", () => {
    const { calls, run } = record("[]");
    awsCli("us-west-2", run).listStacks();
    const inProgress = calls[0].filter(
      (arg) => arg.endsWith("_IN_PROGRESS") && arg !== "REVIEW_IN_PROGRESS",
    );
    assert.deepEqual(inProgress, []);
  });

  test("deletes and waits for the named stack in the region", () => {
    const { calls, run } = record("");
    const cli = awsCli("us-west-2", run);
    cli.startDelete("s");
    cli.waitForDelete("s");
    const tail = ["--region", "us-west-2", "--output", "json"];
    assert.deepEqual(calls, [
      ["aws", "cloudformation", "delete-stack", "--stack-name", "s", ...tail],
      [
        "aws",
        "cloudformation",
        "wait",
        "stack-delete-complete",
        "--stack-name",
        "s",
        ...tail,
      ],
    ]);
  });
});
