import {
  DurableLogger,
  DurableLoggingContext,
} from "@aws/durable-execution-sdk-js";
import * as fs from "fs";

/**
 * A file-based logger that implements DurableLogger interface.
 * Writes log messages to a file in JSON format.
 */
export class FileLogger implements DurableLogger {
  private durableLoggingContext?: DurableLoggingContext;

  constructor(private logFilePath: string) {}

  private writeLog(
    level: string,
    message?: unknown,
    ...optionalParams: unknown[]
  ): void {
    if (!this.durableLoggingContext) {
      return;
    }

    const logData = this.durableLoggingContext.getDurableLogData();
    const params =
      message !== undefined ? [message, ...optionalParams] : optionalParams;

    fs.appendFileSync(
      this.logFilePath,
      JSON.stringify({
        level,
        message: params.length === 1 ? params[0] : params,
        ...logData,
      }) + "\n",
    );
  }

  info(message?: unknown, ...optionalParams: unknown[]): void {
    this.writeLog("info", message, ...optionalParams);
  }

  error(message?: unknown, ...optionalParams: unknown[]): void {
    this.writeLog("error", message, ...optionalParams);
  }

  warn(message?: unknown, ...optionalParams: unknown[]): void {
    this.writeLog("warn", message, ...optionalParams);
  }

  debug(message?: unknown, ...optionalParams: unknown[]): void {
    this.writeLog("debug", message, ...optionalParams);
  }

  configureDurableLoggingContext(
    durableLoggingContext: DurableLoggingContext,
  ): void {
    this.durableLoggingContext = durableLoggingContext;
  }
}
