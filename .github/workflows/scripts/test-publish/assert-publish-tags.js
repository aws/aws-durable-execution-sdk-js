#!/usr/bin/env node
// @ts-check
//
// Assert every recorded `npm publish` invocation in $NPM_LOG used a --tag
// flag whose value is a non-empty string other than `latest`. Used by the
// test-publish-tags workflow to verify that prerelease GitHub Releases
// never end up assigning the `latest` dist-tag.
//
// Inputs:
//   NPM_LOG              path to a JSON-lines log produced by mock-npm.js
//   ASSERT_RESULT_PATH   path to write the structured JSON result document
//
// Outputs:
//   stdout: brief human-readable PASS/FAIL summary
//   $ASSERT_RESULT_PATH: full JSON result document, suitable for upload as
//                        a workflow artifact
//
// Exit codes:
//   0  all invocations used --tag <non-latest, non-empty>
//   1  one or more invocations failed the assertion (or the log was empty)
//   2  misuse (required env vars missing)

import { readFileSync, writeFileSync, existsSync } from "fs";

const logPath = process.env.NPM_LOG;
const resultPath = process.env.ASSERT_RESULT_PATH;
if (!logPath || !resultPath) {
  console.error(
    "assert-publish-tags: NPM_LOG and ASSERT_RESULT_PATH must both be set",
  );
  process.exit(2);
}

// Treat a missing log file the same as an empty one: nothing was recorded.
// Both cases are surfaced to the operator via the empty-log failure reason.
const lines = existsSync(logPath)
  ? readFileSync(logPath, "utf8").split("\n").filter(Boolean)
  : [];

const invocations = lines.map((line, idx) => {
  const index = idx + 1;

  let args;
  try {
    args = JSON.parse(line);
  } catch (err) {
    return {
      index,
      args: line,
      tag: null,
      result: "fail",
      reason: `malformed log entry (not valid JSON): ${err.message}`,
    };
  }
  if (!Array.isArray(args)) {
    return {
      index,
      args,
      tag: null,
      result: "fail",
      reason: "malformed log entry (not a JSON array)",
    };
  }

  const tagIdx = args.indexOf("--tag");
  if (tagIdx === -1) {
    return { index, args, tag: null, result: "fail", reason: "missing --tag" };
  }
  if (tagIdx === args.length - 1) {
    return {
      index,
      args,
      tag: null,
      result: "fail",
      reason: "--tag has no value",
    };
  }
  const tag = args[tagIdx + 1];
  if (typeof tag !== "string" || tag === "") {
    return { index, args, tag, result: "fail", reason: "--tag value is empty" };
  }
  if (tag === "latest") {
    return { index, args, tag, result: "fail", reason: "used --tag latest" };
  }
  return { index, args, tag, result: "ok" };
});

const failures = invocations.filter((i) => i.result === "fail").length;
const empty = invocations.length === 0;
const passed = !empty && failures === 0;

const result = {
  passed,
  ...(empty && { reason: "log was empty (no invocations recorded)" }),
  summary: {
    total: invocations.length,
    ok: invocations.length - failures,
    fail: failures,
  },
  invocations,
};

writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n");

const plural = (n) => (n === 1 ? "" : "s");

if (passed) {
  console.log(
    `PASS: ${invocations.length} invocation${plural(invocations.length)}, all used non-latest --tag`,
  );
} else if (empty) {
  console.log("FAIL: log was empty (no invocations recorded)");
} else {
  console.log(
    `FAIL: ${failures}/${invocations.length} invocation${plural(invocations.length)} failed`,
  );
  for (const inv of invocations.filter((i) => i.result === "fail")) {
    console.log(`  invocation ${inv.index}: ${inv.reason}`);
  }
}

process.exit(passed ? 0 : 1);
