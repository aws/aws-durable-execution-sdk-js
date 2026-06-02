// @ts-check
//
// Unit tests for assert-publish-tags.js. Each test writes a fixture log,
// spawns the script as a subprocess with controlled env vars, and asserts on
// the exit code and the JSON result document the script writes to disk.
//
// Run locally with:
//   node --test .github/workflows/scripts/test-publish/*.test.js

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "assert-publish-tags.js",
);

let workDir = "";

before(() => {
  workDir = mkdtempSync(join(tmpdir(), "assert-publish-tags-test-"));
});

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * Run the script under test against a fixture log.
 * Returns the exit code, captured stdout/stderr, and the parsed result document
 * (or null if the script exited before writing the result file).
 */
function runWith(logContent, { withResultPath = true } = {}) {
  const npmLog = join(workDir, `log-${Math.random().toString(36).slice(2)}`);
  const resultPath = join(
    workDir,
    `result-${Math.random().toString(36).slice(2)}.json`,
  );
  writeFileSync(npmLog, logContent);

  const env = { ...process.env, NPM_LOG: npmLog };
  if (withResultPath) env.ASSERT_RESULT_PATH = resultPath;
  else delete env.ASSERT_RESULT_PATH;

  const r = spawnSync("node", [SCRIPT], { env, encoding: "utf8" });

  const result =
    withResultPath && existsSync(resultPath)
      ? JSON.parse(readFileSync(resultPath, "utf8"))
      : null;

  return { exit: r.status, stdout: r.stdout, stderr: r.stderr, result };
}

/** Helper to build a JSON Lines log from arrays of args. */
function logFor(...invocations) {
  return invocations.map((args) => JSON.stringify(args)).join("\n") + "\n";
}

test("passes when every invocation has --tag <non-latest>", () => {
  const { exit, result, stdout } = runWith(
    logFor(
      ["publish", "--access", "public", "--tag", "beta"],
      ["publish", "--access", "public", "--tag", "next"],
    ),
  );
  assert.equal(exit, 0);
  assert.equal(result.passed, true);
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.ok, 2);
  assert.equal(result.summary.fail, 0);
  assert.match(stdout, /^PASS:/);
});

test("fails when an invocation has no --tag", () => {
  const { exit, result, stdout } = runWith(
    logFor(["publish", "--access", "public"]),
  );
  assert.equal(exit, 1);
  assert.equal(result.passed, false);
  assert.equal(result.invocations[0].result, "fail");
  assert.equal(result.invocations[0].reason, "missing --tag");
  assert.equal(result.invocations[0].tag, null);
  assert.match(stdout, /missing --tag/);
});

test("fails when an invocation uses --tag latest", () => {
  const { exit, result, stdout } = runWith(
    logFor(["publish", "--access", "public", "--tag", "latest"]),
  );
  assert.equal(exit, 1);
  assert.equal(result.passed, false);
  assert.equal(result.invocations[0].reason, "used --tag latest");
  assert.equal(result.invocations[0].tag, "latest");
  assert.match(stdout, /used --tag latest/);
});

test("fails when log is empty (no invocations recorded)", () => {
  const { exit, result, stdout } = runWith("");
  assert.equal(exit, 1);
  assert.equal(result.passed, false);
  assert.match(result.reason, /log was empty/);
  assert.equal(result.summary.total, 0);
  assert.deepEqual(result.invocations, []);
  assert.match(stdout, /log was empty/);
});

test("aggregates ok and fail counts across multiple invocations", () => {
  const { exit, result } = runWith(
    logFor(
      ["publish", "--access", "public", "--tag", "beta"],
      ["publish", "--access", "public", "--tag", "latest"],
      ["publish", "--access", "public"],
    ),
  );
  assert.equal(exit, 1);
  assert.equal(result.summary.total, 3);
  assert.equal(result.summary.ok, 1);
  assert.equal(result.summary.fail, 2);
  assert.equal(result.invocations[0].result, "ok");
  assert.equal(result.invocations[0].tag, "beta");
  assert.equal(result.invocations[1].result, "fail");
  assert.equal(result.invocations[1].reason, "used --tag latest");
  assert.equal(result.invocations[2].result, "fail");
  assert.equal(result.invocations[2].reason, "missing --tag");
});

test("preserves args verbatim in the result document", () => {
  const args = ["publish", "--access", "public", "--tag", "beta"];
  const { result } = runWith(logFor(args));
  assert.deepEqual(result.invocations[0].args, args);
});

test("exits 2 when ASSERT_RESULT_PATH is missing", () => {
  const { exit, result, stderr } = runWith(
    logFor(["publish", "--access", "public", "--tag", "beta"]),
    { withResultPath: false },
  );
  assert.equal(exit, 2);
  assert.equal(result, null);
  assert.match(stderr, /NPM_LOG and ASSERT_RESULT_PATH must both be set/);
});

test("fails when --tag is the last arg (no value follows it)", () => {
  const { exit, result } = runWith(
    logFor(["publish", "--access", "public", "--tag"]),
  );
  assert.equal(exit, 1);
  assert.equal(result.passed, false);
  assert.equal(result.invocations[0].result, "fail");
  assert.equal(result.invocations[0].reason, "--tag has no value");
  assert.equal(result.invocations[0].tag, null);
});

test("fails when --tag value is the empty string", () => {
  const { exit, result } = runWith(
    logFor(["publish", "--access", "public", "--tag", ""]),
  );
  assert.equal(exit, 1);
  assert.equal(result.passed, false);
  assert.equal(result.invocations[0].result, "fail");
  assert.equal(result.invocations[0].reason, "--tag value is empty");
});

test("fails on a malformed JSON line", () => {
  const { exit, result } = runWith("this is not json\n");
  assert.equal(exit, 1);
  assert.equal(result.passed, false);
  assert.equal(result.invocations[0].result, "fail");
  assert.match(
    result.invocations[0].reason,
    /malformed log entry \(not valid JSON\)/,
  );
});

test("fails on a JSON line that is not an array", () => {
  const { exit, result } = runWith('{"not":"an array"}\n');
  assert.equal(exit, 1);
  assert.equal(result.passed, false);
  assert.equal(result.invocations[0].result, "fail");
  assert.match(
    result.invocations[0].reason,
    /malformed log entry \(not a JSON array\)/,
  );
});

test("treats a missing log file as empty (no invocations recorded)", () => {
  const npmLog = join(
    workDir,
    `nonexistent-${Math.random().toString(36).slice(2)}`,
  );
  const resultPath = join(
    workDir,
    `result-${Math.random().toString(36).slice(2)}.json`,
  );
  // Don't create npmLog. Asserter should treat the missing file as empty.

  const env = {
    ...process.env,
    NPM_LOG: npmLog,
    ASSERT_RESULT_PATH: resultPath,
  };
  const r = spawnSync("node", [SCRIPT], { env, encoding: "utf8" });

  assert.equal(r.status, 1);
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert.equal(result.passed, false);
  assert.match(result.reason, /log was empty/);
  assert.equal(result.summary.total, 0);
});
