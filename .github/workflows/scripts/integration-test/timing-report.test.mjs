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
const {
  commentBody,
  findFlaky,
  findOutliers,
  loadReports,
  newest,
  summarize,
  updatePrComment,
} = await import("./timing-report.mjs");

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "timing-report.mjs",
);
const MARKER = "<!-- integration-test-timings -->";
const BOT = "github-actions[bot]";
const VERSIONS = ["22.x", "24.x"];
const slowA = { name: "a.test.ts", seconds: 30, median: 10 };
const flakyB = { name: "b.test.ts > works", runs: 2 };

/**
 * @param {string} version
 * @param {import("./timing-report.mjs").Outlier[]} outliers
 * @param {import("./timing-report.mjs").Flaky[]} flaky
 */
const report = (version, outliers, baselineRuns = 3, flaky = []) => ({
  version,
  baselineRuns,
  outliers,
  flaky,
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

describe("newest", () => {
  test("picks the artifact of the last attempt", () => {
    const first = { id: 1, created_at: "2026-11-23T20:47:23Z" };
    const rerun = { id: 2, created_at: "2026-11-23T21:07:56Z" };
    assert.equal(newest([first, rerun]), rerun);
    assert.equal(newest([rerun, first]), rerun);
  });

  test("returns undefined when there is no artifact", () => {
    assert.equal(newest([]), undefined);
  });
});

describe("summarize", () => {
  test("lists only the tests with status failed", () => {
    const { failedTests } = summarize({
      testResults: [
        {
          name: "/x/src/examples/a/a.test.ts",
          startTime: 0,
          endTime: 1000,
          assertionResults: [
            { title: "fails", status: "failed", duration: 900 },
            { title: "works", status: "passed", duration: 100 },
          ],
        },
        // After a failure, bail fails the files that did not run and skips
        // their tests.
        {
          name: "/x/src/examples/b/b.test.ts",
          startTime: 0,
          endTime: 0,
          status: "failed",
          assertionResults: [{ title: "never ran", status: "skipped" }],
        },
      ],
    });
    assert.deepEqual(failedTests, ["a/a.test.ts > fails"]);
  });
});

describe("findFlaky", () => {
  test("flags a test that failed before a rerun in 2 runs", () => {
    assert.deepEqual(findFlaky({ "a > t": 2, "b > t": 1 }), [
      { name: "a > t", runs: 2 },
    ]);
  });

  test("puts the test with the most runs first", () => {
    assert.deepEqual(
      findFlaky({ "a > t": 2, "b > t": 4 }).map((f) => f.name),
      ["b > t", "a > t"],
    );
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

  test("says so when no file is slow and no test is flaky", () => {
    const body = commentBody([report("22.x", [])], true);
    assert.match(body, /No test file is slower than usual/);
    assert.match(body, /No test is flaky in recent runs/);
    assert.doesNotMatch(body, /\| Test/);
  });

  test("lists a flaky test once, with its runs per version", () => {
    const body = commentBody(
      [
        report("22.x", [], 10, [flakyB]),
        report("24.x", [], 9, [{ ...flakyB, runs: 3 }]),
        report("26.x", [], 10),
      ],
      true,
    );
    assert.match(body, /### Flaky integration tests/);
    assert.match(
      body,
      /\| b\.test\.ts > works \| 2 of 10 runs \| 3 of 9 runs \| - \|/,
    );
    assert.equal(body.match(/b\.test\.ts > works/g)?.length, 1);
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
      "integration-test-timings-22.x": {
        baselineRuns: 3,
        outliers: [slowA],
        flaky: [flakyB],
      },
    });
    assert.deepEqual(loadReports(dir), [
      report("22.x", [slowA], 3, [flakyB]),
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
    await updatePrComment(slow, true, VERSIONS);
    assert.deepEqual(
      writes().map((c) => [c.method, c.path]),
      [["POST", "/repos/aws/repo/issues/5/comments"]],
    );
    assert.match(writes()[0].body ?? "", /a\.test\.ts/);
  });

  test("posts nothing when no file is slow and none exists", async () => {
    await updatePrComment(notSlow, true, VERSIONS);
    assert.deepEqual(writes(), []);
  });

  test("posts a new comment when only a test is flaky", async () => {
    await updatePrComment([report("22.x", [], 3, [flakyB])], true, VERSIONS);
    assert.deepEqual(
      writes().map((c) => c.method),
      ["POST"],
    );
    assert.match(writes()[0].body ?? "", /b\.test\.ts > works/);
  });

  test("updates its own comment after a full check finds no slow file", async () => {
    pages = [[comment(7, BOT)]];
    await updatePrComment(notSlow, true, VERSIONS);
    assert.deepEqual(
      writes().map((c) => [c.method, c.path]),
      [["PATCH", "/repos/aws/repo/issues/comments/7"]],
    );
    assert.match(writes()[0].body ?? "", /No test file is slower than usual/);
  });

  test("keeps the old warning when a test job failed", async () => {
    pages = [[comment(7, BOT)]];
    await updatePrComment(notSlow, false, VERSIONS);
    assert.deepEqual(calls, []);
  });

  test("keeps the old warning when a version had no baseline", async () => {
    pages = [[comment(7, BOT)]];
    await updatePrComment(
      [report("22.x", []), report("24.x", [], 0)],
      true,
      VERSIONS,
    );
    assert.deepEqual(calls, []);
  });

  test("keeps the old warning when no artifact was found", async () => {
    pages = [[comment(7, BOT)]];
    await updatePrComment([], true, VERSIONS);
    assert.deepEqual(calls, []);
  });

  test("still reports a slow file from a failed run, with a note", async () => {
    await updatePrComment(slow, false, VERSIONS);
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
      VERSIONS,
    );
    assert.doesNotMatch(writes()[0].body ?? "", /24\.x/);
  });

  test("keeps the old warning when a version's artifact is missing", async () => {
    pages = [[comment(7, BOT)]];
    await updatePrComment([report("22.x", [])], true, VERSIONS);
    assert.deepEqual(calls, []);
  });

  test("keeps the old warning when no versions are expected", async () => {
    pages = [[comment(7, BOT)]];
    await updatePrComment(notSlow, true, []);
    assert.deepEqual(calls, []);
  });

  test("ignores its own comments that lack the marker", async () => {
    pages = [[comment(10, BOT, "<!-- something else -->")]];
    await updatePrComment(slow, true, VERSIONS);
    assert.deepEqual(
      writes().map((c) => c.method),
      ["POST"],
    );
  });

  test("ignores a person's comment that starts with the marker", async () => {
    pages = [[comment(9, "someone")]];
    await updatePrComment(slow, true, VERSIONS);
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
    await updatePrComment(slow, true, VERSIONS);
    assert.deepEqual(
      writes().map((c) => [c.method, c.path]),
      [["PATCH", "/repos/aws/repo/issues/comments/200"]],
    );
  });

  test("rejects when the GitHub API fails", async () => {
    failWith = 403;
    await assert.rejects(updatePrComment(slow, true, VERSIONS), /GET .*: 403/);
  });
});

// These run the script as the workflow does, with a fake GitHub API.
describe("command line", () => {
  const fakeGithub = join(mkdtempSync(join(tmpdir(), "fake-")), "fake.mjs");
  // FAKE_STATUS: status for every request. FAKE_WRITE_STATUS: status for
  // POST and PATCH. FAKE_COMMENTS: JSON list of PR comments. Writes are
  // printed as "CALL ...".
  writeFileSync(
    fakeGithub,
    `globalThis.fetch = async (url, init = {}) => {
      const method = init.method ?? "GET";
      let status = Number(process.env.FAKE_STATUS ?? 200);
      if (method !== "GET") {
        status = Number(process.env.FAKE_WRITE_STATUS ?? status);
        const note = String(init.body).includes("stopped early") ? " INCOMPLETE" : "";
        console.log("CALL " + method + " " + new URL(url).pathname + note);
      }
      const path = new URL(url).pathname;
      if (path.startsWith("/zip/")) {
        const { readFileSync } = await import("node:fs");
        return new Response(readFileSync(process.env.FAKE_ZIP_DIR + path.slice(4)));
      }
      const runArtifacts = path.match(/\\/runs\\/(\\d+)\\/artifacts$/);
      const body = path.endsWith("/runs")
        ? { workflow_runs: JSON.parse(process.env.FAKE_RUNS ?? "[]") }
        : runArtifacts
          ? { artifacts: JSON.parse(process.env.FAKE_ARTIFACTS ?? "{}")[runArtifacts[1]] ?? [] }
          : path.endsWith("/5/comments") && method === "GET"
            ? JSON.parse(process.env.FAKE_COMMENTS ?? "[]")
            : {};
      return new Response(JSON.stringify(body), { status });
    };`,
  );

  /** @param {string[]} args @param {Record<string, string>} env @param {string} cwd */
  const run = (args, env = {}, cwd = process.cwd()) =>
    spawnSync(process.execPath, ["--import", fakeGithub, SCRIPT, ...args], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        TESTS_PASSED: "true",
        NODE_VERSIONS: "22.x",
        ...env,
      },
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

  test("--comment passes when reading comments fails", () => {
    const dir = artifactFolder({
      "integration-test-timings-22.x": { baselineRuns: 3, outliers: [slowA] },
    });
    const result = run(["--comment", dir], { FAKE_STATUS: "500" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Timing report failed: .*GET .*500/);
  });

  test("--comment passes when posting the comment fails", () => {
    const dir = artifactFolder({
      "integration-test-timings-22.x": { baselineRuns: 3, outliers: [slowA] },
    });
    const result = run(["--comment", dir], { FAKE_WRITE_STATUS: "403" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /CALL POST/);
    assert.match(result.stdout, /Timing report failed: .*POST .*403/);
  });

  test("--comment passes when updating the comment fails", () => {
    const dir = artifactFolder({
      "integration-test-timings-22.x": { baselineRuns: 3, outliers: [] },
    });
    const result = run(["--comment", dir], {
      FAKE_WRITE_STATUS: "403",
      FAKE_COMMENTS: JSON.stringify([
        { id: 7, user: { login: BOT }, body: `${MARKER}\nold` },
      ]),
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Timing report failed: .*PATCH .*403/);
  });

  test("--comment reads NODE_VERSIONS", () => {
    const dir = artifactFolder({
      "integration-test-timings-22.x": { baselineRuns: 3, outliers: [] },
    });
    const env = {
      FAKE_COMMENTS: JSON.stringify([
        { id: 7, user: { login: BOT }, body: `${MARKER}\nold` },
      ]),
    };
    assert.match(
      run(["--comment", dir], { ...env, NODE_VERSIONS: "22.x" }).stdout,
      /CALL PATCH/,
    );
    assert.doesNotMatch(
      run(["--comment", dir], { ...env, NODE_VERSIONS: "22.x,24.x" }).stdout,
      /CALL/,
    );
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

  // Three earlier runs. Runs 1 and 2 passed after a rerun, so each has the
  // artifact of a failed attempt. Run 3 passed at once.
  test("the report mode flags a test that failed before a rerun in 2 runs", () => {
    const cwd = mkdtempSync(join(tmpdir(), "job-"));
    const zips = mkdtempSync(join(tmpdir(), "zips-"));
    /** @param {string} name @param {object} saved */
    const zip = (name, saved) => {
      const folder = mkdtempSync(join(tmpdir(), "artifact-"));
      writeFileSync(
        join(folder, "integration-timings.json"),
        JSON.stringify(saved),
      );
      spawnSync("zip", [
        "-q",
        "-j",
        join(zips, name),
        join(folder, "integration-timings.json"),
      ]);
      return `https://api.github.com/zip/${name}`;
    };
    const passed = { files: { "a.test.ts": 10 }, failedTests: [] };
    /** @param {string[]} failedTests */
    const failed = (failedTests) => ({
      files: { "a.test.ts": 0 },
      failedTests,
    });
    /** @type {Record<string, object[]>} */
    const artifacts = {
      1: [
        {
          id: 11,
          expired: false,
          created_at: "2026-11-01T01:00:00Z",
          archive_download_url: zip("11.zip", failed(["b > t", "c > t"])),
        },
        {
          id: 12,
          expired: false,
          created_at: "2026-11-01T02:00:00Z",
          archive_download_url: zip("12.zip", passed),
        },
      ],
      2: [
        {
          id: 22,
          expired: false,
          created_at: "2026-11-02T02:00:00Z",
          archive_download_url: zip("22.zip", passed),
        },
        {
          id: 21,
          expired: false,
          created_at: "2026-11-02T01:00:00Z",
          archive_download_url: zip("21.zip", failed(["b > t"])),
        },
      ],
      3: [
        {
          id: 31,
          expired: false,
          created_at: "2026-11-03T01:00:00Z",
          archive_download_url: zip("31.zip", passed),
        },
      ],
    };
    const results = join(cwd, "results.json");
    writeFileSync(
      results,
      JSON.stringify({
        testResults: [
          { name: "/x/src/examples/a.test.ts", startTime: 0, endTime: 10000 },
        ],
      }),
    );
    const summary = join(cwd, "summary.md");
    const result = run(
      [results, "integration-test-timings-22.x"],
      {
        GITHUB_STEP_SUMMARY: summary,
        FAKE_RUNS: JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]),
        FAKE_ARTIFACTS: JSON.stringify(artifacts),
        FAKE_ZIP_DIR: zips,
      },
      cwd,
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const saved = JSON.parse(
      readFileSync(join(cwd, "integration-timings.json"), "utf8"),
    );
    assert.equal(saved.baselineRuns, 3);
    assert.deepEqual(saved.flaky, [{ name: "b > t", runs: 2 }]);
    // The failed attempts' 0s timings are not in the baseline, so a.test.ts
    // at its usual 10s is not slow.
    assert.deepEqual(saved.outliers, []);
    assert.match(
      result.stdout,
      /::warning title=Flaky integration test::b > t/,
    );
    assert.match(readFileSync(summary, "utf8"), /\| b > t \| 2 of 3 \|/);
  });
});
