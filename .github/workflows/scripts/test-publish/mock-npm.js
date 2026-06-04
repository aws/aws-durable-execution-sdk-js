#!/usr/bin/env node
// @ts-check
//
// Mock `npm` for the test-publish-tags workflow.
//
// Records each invocation as a JSON array of args, one per line, in $NPM_LOG.
// `iterate-publish-npm.sh` only ever calls `npm publish`, so a no-op mock that
// records invocations is sufficient to verify --tag handling without ever
// hitting the real npm registry.
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
