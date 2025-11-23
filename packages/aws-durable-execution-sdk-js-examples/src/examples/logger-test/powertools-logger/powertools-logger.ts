import {
  DurableLogData,
  EnrichedDurableLogger,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { Logger, LogLevel } from "@aws-lambda-powertools/logger";
import util from "node:util";
import { LogAttributes } from "@aws-lambda-powertools/logger/types";

export const config: ExampleConfig = {
  name: "Powertools Logger",
  description: "Demonstrates different log levels using the powertools logger",
};

const logger = new Logger({
  serviceName: "powertools-logger",
  logLevel: LogLevel.DEBUG,
});

function extractDurableLogInfo(obj: DurableLogData): LogAttributes {
  return {
    execution_arn: obj.executionArn,
    request_id: obj.requestId,
    attempt: obj.attempt,
    operation_id: obj.operationId,
  };
}

class DurablePowertoolsLogger implements EnrichedDurableLogger {
  constructor(private readonly powertoolsLogger: Logger) {}

  private processAdditionalParams(params: unknown[]): LogAttributes[] {
    return params.map((param, i) => {
      if ((typeof param !== "object" || !param) && typeof param !== "string") {
        return {
          [`customMessage-${i}`]: util.format(param),
        };
      }
      return param as Record<string, unknown>;
    });
  }

  info(durableLogData: DurableLogData, message: unknown, ...params: unknown[]) {
    this.powertoolsLogger.info(
      util.format(message),
      extractDurableLogInfo(durableLogData),
      ...this.processAdditionalParams(params),
    );
  }

  warn(durableLogData: DurableLogData, message: unknown, ...params: unknown[]) {
    this.powertoolsLogger.warn(
      util.format(message),
      extractDurableLogInfo(durableLogData),
      ...this.processAdditionalParams(params),
    );
  }

  error(
    durableLogData: DurableLogData,
    message: unknown,
    ...params: unknown[]
  ) {
    this.powertoolsLogger.error(
      util.format(message),
      extractDurableLogInfo(durableLogData),
      ...this.processAdditionalParams(params),
    );
  }

  debug(
    durableLogData: DurableLogData,
    message: unknown,
    ...params: unknown[]
  ) {
    this.powertoolsLogger.debug(
      util.format(message),
      extractDurableLogInfo(durableLogData),
      ...this.processAdditionalParams(params),
    );
  }
}

export const handler = withDurableExecution(async (_event, context) => {
  context.configureLogger({
    customLogger: new DurablePowertoolsLogger(logger),
  });

  context.logger.info("=== Logger Level Demo Starting ===");

  // Test all log levels
  context.logger.debug("Debug message: Detailed debugging information");
  context.logger.info("Info message: General information about execution");
  context.logger.warn("Warning message: Something might need attention");

  // Demonstrate error logging with Error object
  context.logger.error("Error message: Something went wrong (simulated)");

  // Test the generic log method with different levels
  await context.step("log-level-step", async (stepContext) => {
    stepContext.logger.log("DEBUG", "Step debug via log method");
    stepContext.logger.log("INFO", "Step info via log method");
    stepContext.logger.log("WARN", "Step warn via log method");
    stepContext.logger.log("ERROR", "Step error via log method");
    return "step completed";
  });

  // Test after wait to show logging in different execution phases
  context.logger.info("Before wait operation");
  await context.wait({ seconds: 1 });
  context.logger.info("After wait operation - logger still works");

  const userName = "TestUser";
  const userId = 12345;
  context.logger.info("User %s (ID: %d) completed operation", userName, userId);

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

  return "";
});
