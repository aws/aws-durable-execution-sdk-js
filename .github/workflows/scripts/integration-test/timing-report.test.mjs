// @ts-check
//
// Unit tests for timing-report.mjs. Run locally with:
//   node --test .github/workflows/scripts/integration-test/*.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

process.env.GITHUB_REPOSITORY = "aws/repo";
process.env.GITHUB_RUN_ID = "99";
process.env.GITHUB_TOKEN = "token";
process.env.PR_NUMBER = "5";
const { commentBody, findOutliers, loadReports, updatePrComment } =
  await import("./timing-report.mjs");

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "timing-report.mjs",
);
const MARKER = "<!-- integration-test-timings -->";
const BOT = "github-actions[bot]";
const slowA = { name: "a.test.ts", seconds: 30, median: 10 };

/** @param {string} version @param {import("./timing-report.mjs").Outlier[]} outliers */
const report = (version, outliers, baselineRuns = 3) => ({
  version,
  baselineRuns,
  outliers,
});

/**
 * One folder per artifact, as download-artifact writes them.
 * @param {Record<string, object>} artifacts
 */
const artifactFolder = (artifacts) => {
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
    const body = commentBody(
      [
        report("22.x", [slowA]),
        report("24.x", [{ name: "a.test.ts", seconds: 28, median: 9 }]),
      ],
      true,
    );
    assert.equal(body.split("\n")[0], MARKER);
    assert.match(body, /\| Test file \| Node\.js 22\.x \| Node\.js 24\.x \|/);
    assert.equal(body.match(/\| a\.test\.ts \|/g)?.length, 1);
    assert.match(
      body,
      /\| a\.test\.ts \| 30\.0s \(median 10\.0s\) \| 28\.0s \(median 9\.0s\) \|/,
    );
  });

  test("shows - for a version where the file is not slow", () => {
    const body = commentBody(
      [report("22.x", [slowA]), report("24.x", [])],
      true,
    );
    assert.match(body, /\| a\.test\.ts \| 30\.0s \(median 10\.0s\) \| - \|/);
  });

  test("puts the file with the biggest slowdown first", () => {
    const body = commentBody(
      [
        report("22.x", [
          { name: "small.test.ts", seconds: 7, median: 1 },
          slowA,
        ]),
      ],
      true,
    );
    assert.ok(body.indexOf("a.test.ts") < body.indexOf("small.test.ts"));
  });

  test("says so when no file is slow", () => {
    const body = commentBody([report("22.x", [])], true);
    assert.match(body, /No test file is slower than usual/);
    assert.doesNotMatch(body, /\| Test file/);
  });

  test("says when the tests did not all pass", () => {
    assert.match(
      commentBody([report("22.x", [slowA])], false),
      /Some integration tests failed or stopped early/,
    );
    assert.doesNotMatch(
      commentBody([report("22.x", [slowA])], true),
      /failed or stopped early/,
    );
  });
});

describe("loadReports", () => {
  test("reads each version's baseline size and outliers, sorted by version", () => {
    const dir = artifactFolder({
      "integration-test-timings-24.x": { baselineRuns: 0, outliers: [] },
      "integration-test-timings-22.x": { baselineRuns: 3, outliers: [slowA] },
    });
    assert.deepEqual(loadReports(dir), [
      report("22.x", [slowA], 3),
      report("24.x", [], 0),
    ]);
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
  const slow = [report("22.x", [slowA])];
  const notSlow = [report("22.x", []), report("24.x", [])];

  test("posts a new comment when a file is slow and none exists", async () => {
    await updatePrComment(slow, true);
    assert.deepEqual(
      writes().map((c) => [c.method, c.path]),
      [["POST", "/repos/aws/repo/issues/5/comments"]],
    );
    assert.match(writes()[0].body ?? "", /a\.test\.ts/);
  });

  test("posts nothing when no file is slow and none exists", async () => {
    await updatePrComment(notSlow, true);
    assert.deepEqual(writes(), []);
  });

  test("updates its own comment after a full check finds no slow file", async () => {
    pages = [[comment(7, BOT)]];
    await updatePrComment(notSlow, true);
    assert.deepEqual(
      writes().map((c) => [c.method, c.path]),
      [["PATCH", "/repos/aws/repo/issues/comments/7"]],
    );
    assert.match(writes()[0].body ?? "", /No test file is slower than usual/);
  });

  test("keeps the old warning when a test job failed", async () => {
    pages = [[comment(7, BOT)]];
    await updatePrComment(notSlow, false);
    assert.deepEqual(calls, []);
  });

  test("keeps the old warning when a version had no baseline", async () => {
    pages = [[comment(7, BOT)]];
    await updatePrComment([report("22.x", []), report("24.x", [], 0)], true);
    assert.deepEqual(calls, []);
  });

  test("keeps the old warning when no artifact was found", async () => {
    pages = [[comment(7, BOT)]];
    await updatePrComment([], true);
    assert.deepEqual(calls, []);
  });

  test("still reports a slow file from a failed run, with a note", async () => {
    await updatePrComment(slow, false);
    assert.deepEqual(
      writes().map((c) => c.method),
      ["POST"],
    );
    assert.match(writes()[0].body ?? "", /failed or stopped early/);
  });

  test("leaves out a version without a baseline from the table", async () => {
    await updatePrComment(
      [report("22.x", [slowA]), report("24.x", [], 0)],
      true,
    );
    assert.doesNotMatch(writes()[0].body ?? "", /24\.x/);
  });

  test("ignores a person's comment that starts with the marker", async () => {
    pages = [[comment(9, "someone")]];
    await updatePrComment(slow, true);
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
    await updatePrComment(slow, true);
    assert.deepEqual(
      writes().map((c) => [c.method, c.path]),
      [["PATCH", "/repos/aws/repo/issues/comments/200"]],
    );
  });

  test("rejects when the GitHub API fails", async () => {
    failWith = 403;
    await assert.rejects(updatePrComment(slow, true), /GET .*: 403/);
  });
});

// These run the script as the workflow does, with a fake GitHub API.
describe("command line", () => {
  const fakeGithub = join(mkdtempSync(join(tmpdir(), "fake-")), "fake.mjs");
  // FAKE_STATUS: status for every request. Writes are printed as "CALL ...".
  writeFileSync(
    fakeGithub,
    `globalThis.fetch = async (url, init = {}) => {
      const status = Number(process.env.FAKE_STATUS ?? 200);
      const method = init.method ?? "GET";
      if (method !== "GET") {
        const note = String(init.body).includes("stopped early") ? " INCOMPLETE" : "";
        console.log("CALL " + method + " " + new URL(url).pathname + note);
      }
      const body = new URL(url).pathname.endsWith("/runs") ? { workflow_runs: [] } : [];
      return new Response(JSON.stringify(body), { status });
    };`,
  );

  /** @param {string[]} args @param {Record<string, string>} env @param {string} cwd */
  const run = (args, env = {}, cwd = process.cwd()) =>
    spawnSync(process.execPath, ["--import", fakeGithub, SCRIPT, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, TESTS_PASSED: "true", ...env },
    });

  test("--comment reads the artifacts and posts the comment", () => {
    const dir = artifactFolder({
      "integration-test-timings-22.x": { baselineRuns: 3, outliers: [slowA] },
    });
    const result = run(["--comment", dir]);
    assert.equal(result.status, 0);
    assert.match(
      result.stdout,
      /CALL POST \/repos\/aws\/repo\/issues\/5\/comments/,
    );
  });

  test("--comment passes when the GitHub API fails", () => {
    const dir = artifactFolder({
      "integration-test-timings-22.x": { baselineRuns: 3, outliers: [slowA] },
    });
    const result = run(["--comment", dir], { FAKE_STATUS: "500" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Timing report failed: .*500/);
  });

  test("--comment reads TESTS_PASSED", () => {
    const dir = artifactFolder({
      "integration-test-timings-22.x": { baselineRuns: 3, outliers: [slowA] },
    });
    assert.match(
      run(["--comment", dir], { TESTS_PASSED: "false" }).stdout,
      /CALL POST \S+ INCOMPLETE/,
    );
    assert.doesNotMatch(
      run(["--comment", dir], { TESTS_PASSED: "true" }).stdout,
      /INCOMPLETE/,
    );
  });

  test("the report mode saves timings, baseline size and outliers", () => {
    const cwd = mkdtempSync(join(tmpdir(), "job-"));
    const results = join(cwd, "results.json");
    writeFileSync(
      results,
      JSON.stringify({
        testResults: [
          { name: "/x/src/examples/a.test.ts", startTime: 0, endTime: 2000 },
        ],
      }),
    );
    const summary = join(cwd, "summary.md");
    const result = run(
      [results, "integration-test-timings-22.x"],
      { GITHUB_STEP_SUMMARY: summary },
      cwd,
    );
    assert.equal(result.status, 0);
    const saved = JSON.parse(
      readFileSync(join(cwd, "integration-timings.json"), "utf8"),
    );
    assert.deepEqual(saved.files, { "a.test.ts": 2 });
    assert.equal(saved.baselineRuns, 0);
    assert.deepEqual(saved.outliers, []);
    assert.match(readFileSync(summary, "utf8"), /Integration test timings/);
  });

  test("the report mode passes when the baseline lookup fails", () => {
    const cwd = mkdtempSync(join(tmpdir(), "job-"));
    const results = join(cwd, "results.json");
    writeFileSync(results, JSON.stringify({ testResults: [] }));
    const result = run(
      [results, "integration-test-timings-22.x"],
      { FAKE_STATUS: "500", GITHUB_STEP_SUMMARY: join(cwd, "s.md") },
      cwd,
    );
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Could not load the baseline/);
    assert.ok(existsSync(join(cwd, "integration-timings.json")));
  });
});
