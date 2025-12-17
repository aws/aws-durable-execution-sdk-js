// Test handler for CLI integration tests
// This file is committed and doesn't require a build step

import { withDurableExecution } from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(async (event, context) => {
  return "Test CLI Success!";
});

export const customHandler = withDurableExecution(async (event, context) => {
  return "Custom Handler Success!";
});
