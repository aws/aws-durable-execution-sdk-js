// @ts-check
//
// Unit tests for timing-report.mjs. Run locally with:
//   node --test .github/workflows/scripts/integration-test/*.test.mjs

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, test } from "node:test";

process.env.GITHUB_REPOSITORY = "aws/repo";
process.env.GITHUB_RUN_ID = "99";
process.env.GITHUB_TOKEN = "token";
process.env.PR_NUMBER = "5";
const { commentBody, findOutliers, loadReports, updatePrComment } =
  await import("./timing-report.mjs");

const MARKER = "<!-- integration-test-timings -->";
const BOT = "github-actions[bot]";
const slowA = { name: "a.test.ts", seconds: 30, median: 10 };

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

describe("commentBody", () => {
  test("lists a file slow on both versions once, with a cell per version", () => {
    const body = commentBody([
      { version: "22.x", outliers: [slowA] },
      {
        version: "24.x",
        outliers: [{ name: "a.test.ts", seconds: 28, median: 9 }],
      },
    ]);
    assert.equal(body.split("\n")[0], MARKER);
    assert.match(body, /\| Test file \| Node\.js 22\.x \| Node\.js 24\.x \|/);
    assert.equal(body.match(/\| a\.test\.ts \|/g)?.length, 1);
    assert.match(
      body,
      /\| a\.test\.ts \| 30\.0s \(median 10\.0s\) \| 28\.0s \(median 9\.0s\) \|/,
    );
  });

  test("shows - for a version where the file is not slow", () => {
    const body = commentBody([
      { version: "22.x", outliers: [slowA] },
      { version: "24.x", outliers: [] },
    ]);
    assert.match(body, /\| a\.test\.ts \| 30\.0s \(median 10\.0s\) \| - \|/);
  });

  test("puts the file with the biggest slowdown first", () => {
    const body = commentBody([
      {
        version: "22.x",
        outliers: [{ name: "small.test.ts", seconds: 7, median: 1 }, slowA],
      },
    ]);
    assert.ok(body.indexOf("a.test.ts") < body.indexOf("small.test.ts"));
  });

  test("says so when no file is slow", () => {
    const body = commentBody([{ version: "22.x", outliers: [] }]);
    assert.match(body, /No test file is slower than usual/);
    assert.doesNotMatch(body, /\| Test file/);
  });
});

describe("loadReports", () => {
  /** @param {Record<string, object>} artifacts */
  const folder = (artifacts) => {
    const dir = mkdtempSync(join(tmpdir(), "timings-"));
    for (const [name, saved] of Object.entries(artifacts)) {
      mkdirSync(join(dir, name));
      writeFileSync(
        join(dir, name, "integration-timings.json"),
        JSON.stringify(saved),
      );
    }
    return dir;
  };

  test("reads each version's outliers, sorted by version", () => {
    const dir = folder({
      "integration-test-timings-24.x": { baselineRuns: 3, outliers: [] },
      "integration-test-timings-22.x": { baselineRuns: 3, outliers: [slowA] },
    });
    assert.deepEqual(loadReports(dir), [
      { version: "22.x", outliers: [slowA] },
      { version: "24.x", outliers: [] },
    ]);
  });

  test("leaves out a version that had no baseline", () => {
    const dir = folder({
      "integration-test-timings-22.x": { baselineRuns: 0, outliers: [] },
      "integration-test-timings-24.x": { baselineRuns: 2, outliers: [] },
    });
    assert.deepEqual(
      loadReports(dir).map((r) => r.version),
      ["24.x"],
    );
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
  const comment = (id, login, marker = MARKER) => ({
    id,
    user: { login },
    body: `${marker}\nold`,
  });
  const writes = () => calls.filter((c) => c.method !== "GET");
  const slow = [{ version: "22.x", outliers: [slowA] }];
  const notSlow = [{ version: "22.x", outliers: [] }];

  test("posts a new comment when a file is slow and none exists", async () => {
    await updatePrComment(slow);
    assert.deepEqual(
      writes().map((c) => [c.method, c.path]),
      [["POST", "/repos/aws/repo/issues/5/comments"]],
    );
    assert.match(writes()[0].body ?? "", /a\.test\.ts/);
  });

  test("posts nothing when no file is slow and none exists", async () => {
    await updatePrComment(notSlow);
    assert.deepEqual(writes(), []);
  });

  test("updates its own comment when no file is slow any more", async () => {
    pages = [[comment(7, BOT)]];
    await updatePrComment(notSlow);
    assert.deepEqual(
      writes().map((c) => [c.method, c.path]),
      [["PATCH", "/repos/aws/repo/issues/comments/7"]],
    );
    assert.match(writes()[0].body ?? "", /No test file is slower than usual/);
  });

  test("ignores a person's comment that starts with the marker", async () => {
    pages = [[comment(9, "someone")]];
    await updatePrComment(slow);
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
    await updatePrComment(slow);
    assert.deepEqual(
      writes().map((c) => [c.method, c.path]),
      [["PATCH", "/repos/aws/repo/issues/comments/200"]],
    );
  });

  test("rejects when the GitHub API fails", async () => {
    failWith = 403;
    await assert.rejects(updatePrComment(slow), /GET .*: 403/);
  });
});
