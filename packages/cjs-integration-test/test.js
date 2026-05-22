console.log("Testing CJS integration...");

try {
  const sdk = require("@aws/durable-execution-sdk-js");
  console.log("✓ SDK imported successfully");

  // Test basic exports
  const { withDurableExecution } = sdk;
  if (typeof withDurableExecution !== "function") {
    throw new Error("withDurableExecution is not a function");
  }

  console.log("✓ withDurableExecution export verified");
  console.log("✓ CJS integration test passed");
} catch (error) {
  console.error("✗ CJS integration test failed:", error.message);
  process.exit(1);
}
