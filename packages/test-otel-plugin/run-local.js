"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Local runner for app.ts using the LocalDurableTestRunner.
 *
 * Usage:  npx ts-node run-local.ts
 */
const durable_execution_sdk_js_testing_1 = require("@aws/durable-execution-sdk-js-testing");
// Pull the handler that app.ts exports
const { lambdaHandler } = require("./app");
async function main() {
  // Emulate the Lambda environment by setting the X-Ray trace ID env var.
  // The AWS X-Ray ID generator reads this to extract the timestamp-based
  // portion of the trace ID, which keeps spans correlated with the
  // Lambda invocation trace.
  process.env._X_AMZN_TRACE_ID =
    `Root=1-${Math.floor(Date.now() / 1000).toString(16)}-` +
    `${Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join("")};` +
    `Parent=${Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("")};Sampled=1`;
  durable_execution_sdk_js_testing_1.LocalDurableTestRunner.setupTestEnvironment(
    { skipTime: true },
  );
  try {
    const runner =
      new durable_execution_sdk_js_testing_1.LocalDurableTestRunner({
        handlerFunction: lambdaHandler,
      });
    // Register a stub for the "hello-world" function that the handler invokes
    runner.registerFunction("hello-world", async (event) => {
      return { statusCode: 200, body: "Hello from stub!" };
    });
    console.log("Running durable handler locally…\n");
    const execution = await runner.run({
      payload: { message: "hello from local" },
    });
    console.log("Status:", execution.getStatus());
    console.log("Result:", JSON.stringify(execution.getResult(), null, 2));
    const ops = execution.getOperations();
    console.log(`\nRecorded ${ops.length} operation(s):`);
    for (const op of ops) {
      console.log(`  [${op.getType()}] ${op.getName()} — ${op.getStatus()}`);
    }
  } finally {
    durable_execution_sdk_js_testing_1.LocalDurableTestRunner.teardownTestEnvironment();
  }
}
main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
