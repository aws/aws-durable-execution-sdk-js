// @ts-check
//
// Unit tests for timing-report.mjs. Run locally with:
//   node --test .github/workflows/scripts/integration-test/*.test.mjs

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

process.env.GITHUB_REPOSITORY = "aws/repo";
process.env.GITHUB_RUN_ID = "99";
process.env.GITHUB_TOKEN = "token";
process.env.PR_NUMBER = "5";
const { findOutliers, updatePrComment } = await import("./timing-report.mjs");

const ARTIFACT = "integration-test-timings-22.x";
const BOT = "github-actions[bot]";
const slow = [{ name: "a.test.ts", seconds: 30, median: 10 }];

describe("findOutliers", () => {
  /** @param {number} seconds @param {number} median */
  const flagged = (seconds, median) =>
    findOutliers({ f: seconds }, { f: [median] }).length === 1;

  test("ratio rule flags a short test that doubles", () => {
    assert.equal(flagged(4, 2), true);
    assert.equal(flagged(3.9, 2), false);
  });

  test("extra-seconds rule flags a long test that is 5s slower", () => {
    assert.equal(flagged(25, 20), true);
    assert.equal(flagged(24.9, 20), false);
  });

  test("tiny tests are not flagged for small jumps", () => {
    assert.equal(flagged(0.04, 0.02), false);
  });

  test("files without a baseline are skipped", () => {
    assert.deepEqual(findOutliers({ f: 100 }, {}), []);
  });
});

describe("updatePrComment", () => {
  /** @type {{ method: string, path: string, body?: string }[]} */
  let calls;
  /** @type {unknown[][]} */
  let pages;
  let failWith = 0;

  beforeEach(() => {
    calls = [];
    pages = [[]];
    failWith = 0;
    globalThis.fetch = /** @type {typeof fetch} */ (
      async (url, init = {}) => {
        const { pathname, searchParams } = new URL(String(url));
        const method = init.method ?? "GET";
        calls.push({
          method,
          path: pathname,
          body: init.body ? JSON.parse(String(init.body)).body : undefined,
        });
        if (failWith) return new Response("", { status: failWith });
        const page = Number(searchParams.get("page") ?? 1);
        const json = method === "GET" ? (pages[page - 1] ?? []) : {};
        return new Response(JSON.stringify(json), { status: 200 });
      }
    );
  });

  /** @param {number} id @param {string} login */
  const comment = (id, login, artifact = ARTIFACT) => ({
    id,
    user: { login },
    body: `<!-- ${artifact} -->\nold`,
  });
  const writes = () => calls.filter((c) => c.method !== "GET");

  test("posts a new comment when a file is slow and none exists", async () => {
    await updatePrComment(ARTIFACT, slow);
    assert.deepEqual(
      writes().map((c) => [c.method, c.path]),
      [["POST", "/repos/aws/repo/issues/5/comments"]],
    );
    assert.match(
      writes()[0].body ?? "",
      /^<!-- integration-test-timings-22\.x -->/,
    );
    assert.match(
      writes()[0].body ?? "",
      /\| a\.test\.ts \| 30\.0s \| 10\.0s \| \+20\.0s \|/,
    );
  });

  test("posts nothing when no file is slow and none exists", async () => {
    await updatePrComment(ARTIFACT, []);
    assert.deepEqual(writes(), []);
  });

  test("updates its own comment when no file is slow any more", async () => {
    pages = [[comment(7, BOT)]];
    await updatePrComment(ARTIFACT, []);
    assert.deepEqual(
      writes().map((c) => [c.method, c.path]),
      [["PATCH", "/repos/aws/repo/issues/comments/7"]],
    );
    assert.match(writes()[0].body ?? "", /No test file is slower than usual/);
  });

  test("leaves the other Node.js version's comment alone", async () => {
    pages = [[comment(8, BOT, "integration-test-timings-24.x")]];
    await updatePrComment(ARTIFACT, slow);
    assert.deepEqual(
      writes().map((c) => c.method),
      ["POST"],
    );
  });

  test("ignores a person's comment that starts with the marker", async () => {
    pages = [[comment(9, "someone")]];
    await updatePrComment(ARTIFACT, slow);
    assert.deepEqual(
      writes().map((c) => c.method),
      ["POST"],
    );
  });

  test("finds its comment on a later page", async () => {
    const filler = Array.from({ length: 100 }, (_, i) =>
      comment(i, "someone", "x"),
    );
    pages = [filler, [comment(200, BOT)]];
    await updatePrComment(ARTIFACT, slow);
    assert.deepEqual(
      writes().map((c) => [c.method, c.path]),
      [["PATCH", "/repos/aws/repo/issues/comments/200"]],
    );
  });

  test("rejects when the GitHub API fails", async () => {
    failWith = 403;
    await assert.rejects(updatePrComment(ARTIFACT, slow), /GET .*: 403/);
  });
});
