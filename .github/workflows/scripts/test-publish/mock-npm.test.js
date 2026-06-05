// @ts-check
//
// Unit tests for mock-npm.js. The asserter (assert-publish-tags.js) depends on
// mock-npm producing exactly one JSON-array line per invocation and appending
// (not overwriting) on subsequent calls. These tests pin that contract.
//
// Run locally with:
//   node --test .github/workflows/scripts/test-publish/*.test.js

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "mock-npm.js");

let workDir = "";

before(() => {
  workDir = mkdtempSync(join(tmpdir(), "mock-npm-test-"));
});

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * Run mock-npm with the given args. Returns the exit code, captured streams,
 * and the contents of NPM_LOG (or null if the file wasn't created).
 */
function run(args, { setLog = true } = {}) {
  const npmLog = join(workDir, `log-${Math.random().toString(36).slice(2)}`);
  const env = { ...process.env };
  if (setLog) env.NPM_LOG = npmLog;
  else delete env.NPM_LOG;

  const r = spawnSync("node", [SCRIPT, ...args], { env, encoding: "utf8" });
  const log =
    setLog && existsSync(npmLog) ? readFileSync(npmLog, "utf8") : null;
  return { exit: r.status, stdout: r.stdout, stderr: r.stderr, npmLog, log };
}

test("records a single invocation as a JSON Lines array of args", () => {
  const args = ["publish", "--access", "public", "--tag", "beta"];
  const { exit, log } = run(args);
  assert.equal(exit, 0);
  assert.equal(log, JSON.stringify(args) + "\n");
});

test("appends on subsequent invocations (does not overwrite)", () => {
  const npmLog = join(workDir, "appending.log");
  const env = { ...process.env, NPM_LOG: npmLog };
  spawnSync("node", [SCRIPT, "publish", "--tag", "beta"], { env });
  spawnSync("node", [SCRIPT, "publish", "--tag", "next"], { env });
  spawnSync("node", [SCRIPT, "publish", "--tag", "rc"], { env });

  const lines = readFileSync(npmLog, "utf8").split("\n").filter(Boolean);
  assert.equal(lines.length, 3);
  assert.deepEqual(JSON.parse(lines[0]), ["publish", "--tag", "beta"]);
  assert.deepEqual(JSON.parse(lines[1]), ["publish", "--tag", "next"]);
  assert.deepEqual(JSON.parse(lines[2]), ["publish", "--tag", "rc"]);
});

test("preserves args containing spaces and special characters verbatim", () => {
  const args = [
    "publish",
    "--registry=https://example.com/path?x=1&y=2",
    "--note",
    "value with spaces",
    "--quote",
    'has "quotes" and \\backslashes',
  ];
  const { exit, log } = run(args);
  assert.equal(exit, 0);
  assert.deepEqual(JSON.parse(log.trim()), args);
});

test("handles invocation with no positional args", () => {
  const { exit, log } = run([]);
  assert.equal(exit, 0);
  assert.equal(log, "[]\n");
});

test("exits 2 with a clear error when NPM_LOG is unset", () => {
  const { exit, stderr, log } = run(["publish"], { setLog: false });
  assert.equal(exit, 2);
  assert.equal(log, null);
  assert.match(stderr, /NPM_LOG must be set/);
});

test("creates the log file if it does not exist yet", () => {
  // Same as the "single invocation" test, but assert the file was created
  // from scratch rather than appended to a pre-existing file.
  const npmLog = join(workDir, "fresh.log");
  assert.equal(existsSync(npmLog), false);

  const env = { ...process.env, NPM_LOG: npmLog };
  const r = spawnSync("node", [SCRIPT, "publish"], { env });

  assert.equal(r.status, 0);
  assert.equal(existsSync(npmLog), true);
  assert.equal(
    readFileSync(npmLog, "utf8"),
    JSON.stringify(["publish"]) + "\n",
  );
});
