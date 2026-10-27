/**
 * CJS Integration Test
 *
 * This test verifies the SDK can be consumed by external CJS projects
 * without errors like the fileURLToPath issue we fixed.
 */

(async () => {
  console.log("Testing CJS import of AWS Durable Execution SDK...");

  try {
    process.env.DURABLE_EXECUTION_PLUGINS = "@example/durable-plugin-cjs";
    globalThis.__dynamicPluginInvocationCount = 0;

    // This import will trigger version detection and any CJS compatibility issues
    const { withDurableExecution } = require("@aws/durable-execution-sdk-js");

    console.log("✓ SDK imported successfully");

    // Test creating a durable function
    const handler = withDurableExecution(
      async () => ({ message: "Hello from CJS consumer" }),
      {
        durableExecutionClient: {
          getExecutionState: async () => ({ Operations: [], NextMarker: "" }),
          checkpoint: async () => ({}),
        },
      },
    );

    console.log("✓ Durable function created successfully");

    const result = await handler(
      {
        CheckpointToken: "checkpoint-token",
        DurableExecutionArn:
          "arn:aws:lambda:us-east-1:123456789012:function:test",
        InitialExecutionState: {
          Operations: [
            {
              Id: "initial",
              Type: "EXECUTION",
              Status: "STARTED",
              StartTimestamp: "2026-08-10T00:00:00.000Z",
              ExecutionDetails: { InputPayload: "{}" },
            },
          ],
          NextMarker: "",
        },
      },
      {
        awsRequestId: "request-id",
        getRemainingTimeInMillis: () => 30_000,
      },
    );

    if (result.Status !== "SUCCEEDED") {
      throw new Error(`Expected SUCCEEDED, received ${result.Status}`);
    }
    if (globalThis.__dynamicPluginInvocationCount !== 1) {
      throw new Error("CJS layer plugin did not receive the invocation");
    }

    console.log("✓ CJS plugin loaded from simulated Lambda layer");
    console.log("✓ All CJS integration tests passed");
  } catch (error) {
    console.error("✗ CJS integration test failed:");
    console.error(error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
