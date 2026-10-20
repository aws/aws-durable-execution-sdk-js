import {
  withDurableExecution,
  DurableContext,
  createPowertoolsLogger,
  PowertoolsDurableLogger,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { Logger, LogLevel } from "@aws-lambda-powertools/logger";

export const config: ExampleConfig = {
  name: "Powertools Logger",
  description:
    "Demonstrates different log levels using the powertools logger with durable execution metadata",
};

const logger = new Logger({
  serviceName: "powertools-logger",
  logLevel: LogLevel.DEBUG,
});

export const handler = withDurableExecution(
  async (_event, context: DurableContext<PowertoolsDurableLogger<Logger>>) => {
    // The adapter adds executionArn, requestId, operationId, operationName,
    // and attempt to every log entry.
    context.configureLogger({
      customLogger: createPowertoolsLogger(logger),
    });

    context.logger.info("=== Logger Level Demo Starting ===");

    // Test all log levels
    context.logger.debug("Debug message: Detailed debugging information");
    context.logger.info("Info message: General information about execution");
    context.logger.warn("Warning message: Something might need attention");

    // Demonstrate error logging with Error object
    context.logger.error("Error message: Something went wrong (simulated)");

    // Test after wait to show logging in different execution phases
    context.logger.info("Before wait operation");
    await context.wait({ seconds: 1 });
    context.logger.info("After wait operation - logger still works");

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

    // Test single parameter object in step context
    await context.step("direct-object-step", async (stepContext) => {
      const stepObject = { stepData: "value", num: 42 };
      stepContext.logger.info("message", stepObject);

      const stepError = new Error("Step context direct error");
      stepContext.logger.error("message", stepError);
      return "direct object step completed";
    });

    // Test error logging outside step context
    const error = new Error("First error");
    context.logger.error("Errors in context:", error);

    return "";
  },
);
