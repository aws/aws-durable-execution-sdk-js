console.log("Testing ESM integration...");

try {
  const sdk = await import("@aws/durable-execution-sdk-js");
  console.log("✓ SDK imported successfully");

  const { withDurableExecution } = sdk;
  if (typeof withDurableExecution !== "function") {
    throw new Error("withDurableExecution is not a function");
  }

  console.log("✓ withDurableExecution export verified");
  console.log("✓ ESM integration test passed");
} catch (error) {
  console.error("✗ ESM integration test failed:", error.message);
  process.exit(1);
}
