console.log("Testing ESM integration...");

try {
  process.env.DURABLE_EXECUTION_PLUGINS = "@example/durable-plugin-esm";
  globalThis.__dynamicPluginInvocationCount = 0;

  const sdk = await import("@aws/durable-execution-sdk-js");
  console.log("✓ SDK imported successfully");

  const { withDurableExecution } = sdk;
  if (typeof withDurableExecution !== "function") {
    throw new Error("withDurableExecution is not a function");
  }

  console.log("✓ withDurableExecution export verified");

  const handler = withDurableExecution(
    async () => ({ message: "Hello from ESM consumer" }),
    {
      durableExecutionClient: {
        getExecutionState: async () => ({ Operations: [], NextMarker: "" }),
        checkpoint: async () => ({}),
      },
    },
  );
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
    throw new Error("ESM layer plugin did not receive the invocation");
  }

  console.log("✓ ESM plugin loaded from simulated Lambda layer");

  process.env.DURABLE_EXECUTION_PLUGINS =
    "@example/durable-plugin-missing-peer";
  const failingHandler = withDurableExecution(async () => ({
    message: "This handler should not run",
  }));
  const failureResult = await failingHandler(
    {
      CheckpointToken: "checkpoint-token",
      DurableExecutionArn:
        "arn:aws:lambda:us-east-1:123456789012:function:test",
      InitialExecutionState: { Operations: [], NextMarker: "" },
    },
    {
      awsRequestId: "request-id",
      getRemainingTimeInMillis: () => 30_000,
    },
  );
  const failureMessage = failureResult.Error?.ErrorMessage ?? "";
  if (failureResult.Status !== "FAILED") {
    throw new Error(`Expected FAILED, received ${failureResult.Status}`);
  }
  if (
    !failureMessage.includes(
      "@example/durable-plugin-peer-that-is-not-installed",
    )
  ) {
    throw new Error(
      `Missing peer dependency was not reported: ${failureMessage}`,
    );
  }
  if (
    failureMessage.includes(
      "Unable to resolve '@example/durable-plugin-missing-peer'",
    ) ||
    failureMessage.includes(
      "Ensure the package is installed in the function artifact",
    )
  ) {
    throw new Error(`Evaluation failure was mislabeled: ${failureMessage}`);
  }

  console.log("✓ ESM layer evaluation errors preserve the missing peer cause");
  console.log("✓ ESM integration test passed");
} catch (error) {
  console.error("✗ ESM integration test failed:", error.message);
  process.exit(1);
}
