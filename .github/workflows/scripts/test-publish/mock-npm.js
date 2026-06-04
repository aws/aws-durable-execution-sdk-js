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
  } else {
    // Default: simulate correct tags for other packages
    // For prerelease packages, latest should be stable, beta should be prerelease
    const mockResponse = packageName.includes("prerelease") 
      ? { latest: "1.0.0", beta: packageName.includes("alpha") ? "2.1.0-alpha.1" : "2.0.0-beta.1" }
      : { latest: packageName === "@aws/durable-execution-sdk-js" ? "2.0.0-alpha.1" : "1.0.0" };
    console.log(JSON.stringify(mockResponse));
  }
} else if (args[0] === "view" && args.includes("versions") && args.includes("--json")) {
  // Mock versions list for rollback testing
  const mockVersions = ["1.0.0", "1.1.0", "2.0.0", "2.1.0-beta.1"];
  console.log(JSON.stringify(mockVersions));
}
