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
    // Simulate tag mismatch - latest points to wrong version
    const mockResponse = { latest: "1.0.0", beta: "2.0.0" };
    console.log(JSON.stringify(mockResponse));
  } else if (packageName === "@aws/durable-execution-sdk-js") {
    // This package has prerelease version 2.0.0-alpha.1, should go to beta
    // So latest should NOT equal our version (verification should pass)
    const mockResponse = { latest: "1.9.0", beta: "2.0.0-alpha.1" };
    console.log(JSON.stringify(mockResponse));
  } else {
    // eslint-plugin (1.0.0) and testing (1.1.1) are stable versions
    // Even with PRERELEASE=true flag, stable versions go to latest
    // So latest should equal our version (verification should pass)
    const version = packageName.includes("eslint") ? "1.0.0" : "1.1.1";
    const mockResponse = { latest: version, beta: "0.9.0-beta.1" };
    console.log(JSON.stringify(mockResponse));
  }
} else if (args[0] === "view" && args.includes("versions") && args.includes("--json")) {
  // Mock versions list for rollback testing
  const mockVersions = ["1.0.0", "1.1.0", "2.0.0", "2.1.0-beta.1"];
  console.log(JSON.stringify(mockVersions));
}
