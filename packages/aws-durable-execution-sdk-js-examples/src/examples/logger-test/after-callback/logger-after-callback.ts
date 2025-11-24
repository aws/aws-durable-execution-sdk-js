import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { FileLogger } from "../../../utils/file-logger";

export const config: ExampleConfig = {
  name: "Logger After Callback",
  description: "Test logger mode switching after createCallback operation",
};

interface LoggerTestEvent {
  logFilePath?: string;
  modeAware?: boolean;
}

export const handler = withDurableExecution(
  async (event: LoggerTestEvent, context) => {
    if (event.logFilePath) {
      const fileLogger = new FileLogger(event.logFilePath);

      context.configureLogger({
        customLogger: fileLogger,
        modeAware: event.modeAware ?? true,
      });
    } else {
      context.configureLogger({ modeAware: event.modeAware ?? true });
    }

    context.logger.info("Before createCallback");

    const [callbackPromise, callbackId] =
      await context.createCallback<string>();

    const result = await callbackPromise;

    context.logger.info("After createCallback");

    return { message: "Success", callbackId, result };
  },
);
