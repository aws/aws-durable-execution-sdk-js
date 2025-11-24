import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { Logger, LogLevel } from "@aws-lambda-powertools/logger";
import { DurableContext } from "../../../../../aws-durable-execution-sdk-js/dist-types/types";

export const config: ExampleConfig = {
  name: "Simple Powertools Logger",
  description:
    "Demonstrates using a powertools logger directly without implementing DurableLogger interface fully",
};

const logger = new Logger({
  serviceName: "simple-logger",
  logLevel: LogLevel.DEBUG,
});

export const handler = withDurableExecution(
  async (_event, context: DurableContext<Logger>) => {
    // Pass the logger directly without wrapping it in a DurableLogger implementation
    context.configureLogger({
      customLogger: logger,
    });

    context.logger.info("=== Simple Logger Demo Starting ===");
    context.logger.info(
      "This logger does not implement configureDurableLoggingContext",
    );

    // Test basic logging operations
    context.logger.debug(
      "Debug message: Raw logger without DurableLogger wrapper",
    );
    context.logger.info("Info message: Using powertools logger directly");
    context.logger.warn(
      "Warning message: No durable logging context available",
    );

    // Test after wait to show logging in different execution phases
    context.logger.info("Before wait operation");
    await context.wait({ seconds: 1 });
    context.logger.info("After wait operation - logger still works");

    // Test in step context
    await context.step("simple-step", async (stepContext) => {
      stepContext.logger.info("Info log from step context");
      stepContext.logger.debug("Debug log from step context");
      stepContext.logger.warn("Warning log from step context");

      // Note: Without configureDurableLoggingContext, we don't get
      // automatic durable execution metadata in logs
      const error = new Error("Step context error");
      stepContext.logger.error("Error from step context:", error);
      return "step completed";
    });

    // Test runInChildContext logging
    await context.runInChildContext("child-context", async (childContext) => {
      childContext.logger.info("Info log from child context");
      childContext.logger.debug("Debug log from child context");
      childContext.logger.warn("Warning log from child context");

      const childError = new Error("Child context error");
      childContext.logger.error("Error from child context:", childError);
      return "child context completed";
    });

    // Test error logging outside any context
    const mainError = new Error("Main context error");
    context.logger.error("Errors in main context:", mainError);

    context.logger.info("=== Simple Logger Demo Completed ===");

    return "Simple logger example completed successfully";
  },
);
