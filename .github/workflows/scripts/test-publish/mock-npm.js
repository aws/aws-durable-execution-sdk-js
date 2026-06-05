#!/usr/bin/env node
// @ts-check
//
// Mock `npm` for the test-publish workflows.
//
// Records each invocation as a JSON array of args, one per line, in $NPM_LOG.
// Also answers `npm view <pkg> dist-tags --json` so the post-publish
// verification path (verify_dist_tags) can be exercised without touching the
// real registry.
//
// Verification now asserts dist_tags[expectedTag] === publishedVersion for
// both `latest` and `beta`. To make the happy path pass regardless of which
// tag a package was published to, real packages report BOTH tags pointing at
// the package's actual version. Dedicated test packages model explicit
// pass/mismatch scenarios.
//
// Wire up by symlinking this file as `npm` in a directory at the front of
// PATH and exporting NPM_LOG=<path> before invoking the script under test.

import { appendFileSync, readFileSync } from "fs";

const logPath = process.env.NPM_LOG;
if (!logPath) {
  console.error("mock-npm: NPM_LOG must be set");
  process.exit(2);
}

const args = process.argv.slice(2);
appendFileSync(logPath, JSON.stringify(args) + "\n");

// Map of real package names to their directory, used to read the actual
// version so the mock stays correct as versions change.
const PACKAGE_DIRS = {
  "@aws/durable-execution-sdk-js": "packages/aws-durable-execution-sdk-js",
  "@aws/durable-execution-sdk-js-testing":
    "packages/aws-durable-execution-sdk-js-testing",
  "@aws/durable-execution-sdk-js-eslint-plugin":
    "packages/aws-durable-execution-sdk-js-eslint-plugin",
};

function readVersion(dir) {
  return JSON.parse(readFileSync(`${dir}/package.json`, "utf8")).version;
}

if (args[0] === "view" && args.includes("dist-tags") && args.includes("--json")) {
  const packageName = args[1];

  if (packageName === "test-verify-fail") {
    // The version under test is 2.0.0, but neither tag points to it -> the
    // verification must FAIL for both latest and beta expectations.
    console.log(JSON.stringify({ latest: "1.0.0", beta: "1.0.0" }));
  } else if (packageName === "test-verify-pass") {
    // The version under test is 1.0.0 and both tags point to it -> PASS.
    console.log(JSON.stringify({ latest: "1.0.0", beta: "1.0.0" }));
  } else if (PACKAGE_DIRS[packageName]) {
    // Real packages: report both tags at the package's actual version so the
    // happy path passes whether the package was published to latest or beta.
    let version = "0.0.0";
    try {
      version = readVersion(PACKAGE_DIRS[packageName]);
    } catch {
      // fall back to sentinel
    }
    console.log(JSON.stringify({ latest: version, beta: version }));
  } else {
    // Unknown package fallback.
    console.log(JSON.stringify({ latest: "0.0.0", beta: "0.0.0" }));
  }
}
