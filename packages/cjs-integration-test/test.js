/**
 * CJS Integration Test
 *
 * This test verifies the SDK can be consumed by external CJS projects
 * without errors like the fileURLToPath issue we fixed.
 */

console.log("Testing CJS import of AWS Durable Execution SDK...");

try {
  // This import will trigger version detection and any CJS compatibility issues
  const { withDurableExecution } = require("@aws/durable-execution-sdk-js");

  console.log("✓ SDK imported successfully");

  // Test creating a durable function
  const handler = withDurableExecution(async (event, context) => {
    return { message: "Hello from CJS consumer" };
  });

  console.log("✓ Durable function created successfully");
  console.log("✓ All CJS integration tests passed");
} catch (error) {
  console.error("✗ CJS integration test failed:");
  console.error(error.message);
  console.error(error.stack);
  process.exit(1);
}
