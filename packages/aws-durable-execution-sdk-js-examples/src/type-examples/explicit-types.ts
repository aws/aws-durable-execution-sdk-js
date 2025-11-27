import {
  DurableExecutionHandler,
  DurableLambdaHandler,
  DurableLogger,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../types";

interface UserEvent {
  userId: string;
  action: "create" | "update" | "delete";
  data: Record<string, any>;
}

interface ProcessResult {
  success: boolean;
  userId: string;
  processedAt: string;
  action: string;
}

interface CustomLogger extends DurableLogger {
  warn(): void;
}

export const config: ExampleConfig = {
  name: "Explicit Types",
  description: "Uses explicit type parameters for event, result, and logger",
};

const durableHandler: DurableExecutionHandler<
  UserEvent,
  ProcessResult,
  CustomLogger
> = async (event, context) => {
  const validationResult = await context.step("validate", async () => {
    return { isValid: true, userId: event.userId };
  });

  if (!validationResult.isValid) {
    throw new Error("Invalid user data");
  }

  const processedData = await context.step("process", async () => {
    return {
      action: event.action,
      processedData: event.data,
      timestamp: new Date().toISOString(),
    };
  });

  await context.wait({ seconds: 1 });

  // @ts-expect-error - The warn method was overriden, so it doesn't take a first parameter now
  context.logger.warn({});

  return {
    success: true,
    userId: event.userId,
    processedAt: processedData.timestamp,
    action: processedData.action,
  };
};

export const typedHandler: DurableLambdaHandler =
  withDurableExecution(durableHandler);
