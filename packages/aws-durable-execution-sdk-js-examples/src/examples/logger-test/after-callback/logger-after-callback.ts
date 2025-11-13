import { withDurableExecution, Logger } from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import * as fs from "fs";

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
      const fileLogger: Logger = {
        log: (level, message, data) => {
          fs.appendFileSync(
            event.logFilePath!,
            JSON.stringify({ level, message, data }) + "\n",
          );
        },
        info: (message, data) => {
          fs.appendFileSync(
            event.logFilePath!,
            JSON.stringify({ level: "info", message, data }) + "\n",
          );
        },
        error: (message, error, data) => {
          fs.appendFileSync(
            event.logFilePath!,
            JSON.stringify({ level: "error", message, error, data }) + "\n",
          );
        },
        warn: (message, data) => {
          fs.appendFileSync(
            event.logFilePath!,
            JSON.stringify({ level: "warn", message, data }) + "\n",
          );
        },
        debug: (message, data) => {
          fs.appendFileSync(
            event.logFilePath!,
            JSON.stringify({ level: "debug", message, data }) + "\n",
          );
        },
      };

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
