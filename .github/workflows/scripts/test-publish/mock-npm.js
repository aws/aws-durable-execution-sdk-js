#!/usr/bin/env node
// @ts-check
//
// Mock `npm` for the test-publish-tags workflow.
//
// Records each invocation as a JSON array of args, one per line, in $NPM_LOG.
// Also handles `npm view` commands to mock dist-tags for verification testing.
//
// Wire up by symlinking this file as `npm` in a directory at the front of
// PATH and exporting NPM_LOG=<path> before invoking the script under test.

import { appendFileSync } from "fs";

const logPath = process.env.NPM_LOG;
if (!logPath) {
  console.error("mock-npm: NPM_LOG must be set");
  process.exit(2);
}

const args = process.argv.slice(2);
appendFileSync(logPath, JSON.stringify(args) + "\n");

// Handle npm view commands for dist-tags verification
if (args[0] === "view" && args.includes("dist-tags") && args.includes("--json")) {
  const packageName = args[1];
  
  // Simulate different scenarios based on package name
  if (packageName === "test-verify-fail") {
    // Simulate tag mismatch - latest points to wrong version (different from what we expect)
    const mockResponse = { latest: "1.0.0", beta: "2.0.0" };
    console.log(JSON.stringify(mockResponse));
  } else if (packageName === "test-verify-pass") {
    // Simulate correct tags - latest should match the version we're testing
    const mockResponse = { latest: "1.0.0", beta: "0.9.0-beta.1" };
    console.log(JSON.stringify(mockResponse));
  } else if (packageName.startsWith("@aws/durable-execution-sdk-js")) {
    // For real AWS packages: the e2e test that reaches verification runs with
    // PRERELEASE=true, so ALL packages are published with --tag beta and
    // EXPECTED_TAG=beta. Beta verification asserts `latest != publishedVersion`.
    // Return a sentinel old `latest` that can never equal a real version, so
    // beta verification passes regardless of the current package versions.
    const mockResponse = { latest: "0.0.0", beta: "0.0.0-beta.0" };
    console.log(JSON.stringify(mockResponse));
  } else {
    // Default fallback for unknown packages
    const mockResponse = { latest: "1.0.0", beta: "0.9.0-beta.1" };
    console.log(JSON.stringify(mockResponse));
  }
} else if (args[0] === "view" && args.includes("versions") && args.includes("--json")) {
  // Mock versions list for rollback testing
  const mockVersions = ["1.0.0", "1.1.0", "2.0.0", "2.1.0-beta.1"];
  console.log(JSON.stringify(mockVersions));
}
