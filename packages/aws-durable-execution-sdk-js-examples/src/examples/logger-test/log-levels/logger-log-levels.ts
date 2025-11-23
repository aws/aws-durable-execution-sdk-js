import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Logger Log Levels",
  description:
    "Demonstrates different log levels (DEBUG, INFO, WARN, ERROR) in durable execution context",
};

export const handler = withDurableExecution(async (_event, context) => {
  context.logger.info("=== Logger Level Demo Starting ===");

  // Test all log levels
  context.logger.debug("Debug message: Detailed debugging information");
  context.logger.info("Info message: General information about execution");
  context.logger.warn("Warning message: Something might need attention");

  // Demonstrate error logging with Error object
  context.logger.error("Error message: Something went wrong (simulated)");

  // Test the generic log method with different levels
  await context.step("log-level-step", async (stepContext) => {
    stepContext.logger.log?.("DEBUG", "Step debug via log method");
    stepContext.logger.log?.("INFO", "Step info via log method");
    stepContext.logger.log?.("WARN", "Step warn via log method");
    stepContext.logger.log?.("ERROR", "Step error via log method");
    return "step completed";
  });

  // Test logging with complex objects and multiple parameters
  const testData = {
    key: "value",
    nested: { prop: "test" },
    array: [1, 2, 3],
  };

  context.logger.info("Logging with object:", testData);
  context.logger.debug(
    "Debug with multiple params:",
    "param1",
    42,
    true,
    testData,
  );

  // Test after wait to show logging in different execution phases
  context.logger.info("Before wait operation");
  await context.wait({ seconds: 1 });
  context.logger.info("After wait operation - logger still works");

  // Test logging with util.format style parameters
  const userName = "TestUser";
  const userId = 12345;
  context.logger.info("User %s (ID: %d) completed operation", userName, userId);

  // Test stepContext.logger methods directly
  await context.step("debug-step", async (stepContext) => {
    stepContext.logger.info("Info log from step context");
    stepContext.logger.debug("Debug log from step context");
    stepContext.logger.warn("Warning log from step context");
    stepContext.logger.error("Error log from step context");
    return "debug step completed";
  });

  // Test runInChildContext logging (behaves same as step)
  await context.runInChildContext("child-context", async (childContext) => {
    childContext.logger.info("Info log from child context");
    childContext.logger.debug("Debug log from child context");
    childContext.logger.warn("Warning log from child context");
    const childError = new Error("Child context error");
    childContext.logger.error(
      "Error from child context with Error object:",
      childError,
    );
    return "child context completed";
  });

  // Test Error object logging behavior - objects should appear in message
  const testError = new Error("Structured error test");
  testError.stack = "Error: Structured error test\n    at handler.ts:1:1";
  context.logger.error("Testing error object serialization:", testError);

  // Test object logging - should serialize in message field
  const complexObject = {
    user: { id: 123, name: "John" },
    settings: { theme: "dark", notifications: true },
    data: [1, 2, { nested: "value" }],
  };
  context.logger.info("Complex object test:", complexObject);

  // Test circular object handling
  const circularObj: any = { name: "circular" };
  circularObj.self = circularObj;
  context.logger.info("Circular object test:", circularObj);

  // Test logging objects directly without message
  const directObject = { direct: "object", test: true };
  context.logger.info(directObject);

  // Test logging error directly without message
  const directError = new Error("Direct error logging");
  directError.stack = "Error: Direct error logging\n    at handler.ts:123:45";
  context.logger.error(directError);

  // Test single parameter object in step context
  await context.step("direct-object-step", async (stepContext) => {
    const stepObject = { stepData: "value", num: 42 };
    stepContext.logger.info(stepObject);

    const stepError = new Error("Step context direct error");
    stepContext.logger.error(stepError);
    return "direct object step completed";
  });

  // Test multiple error logging outside step context
  const error1 = new Error("First error");
  const error2 = new Error("Second error");
  context.logger.error(
    "Multiple errors in context:",
    error1,
    error2,
    "additional data",
  );

  // Test multiple error logging inside step context
  await context.step("multiple-error-step", async (stepContext) => {
    const stepError1 = new Error("First step error");
    const stepError2 = new Error("Second step error");
    stepContext.logger.error(
      "Multiple errors in step:",
      stepError1,
      stepError2,
      "step data",
    );
    return "multiple error step completed";
  });

  try {
    // Test retry behavior with attempt field logging - fails 3 times then succeeds
    await context.step(
      "retry-with-attempts",
      async (stepContext) => {
        // Log attempt information - this will show attempt field in structured logs
        stepContext.logger.info("Executing retry step");
        stepContext.logger.warn("This step will fail on first 3 attempts");

        // Simulate failure for first 3 attempts
        throw new Error("Simulated failure for retry demonstration");
      },
      {
        retryStrategy: (_, attemptCount) => {
          return {
            shouldRetry: attemptCount < 4, // Fail 3 times
            delay: { seconds: 1 * attemptCount },
          };
        },
      },
    );
  } catch {
    // ignore failure
  }

  context.logger.info("=== Logger Level Demo Complete ===");

  return "";
});
