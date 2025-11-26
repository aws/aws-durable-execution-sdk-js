/* eslint-disable @typescript-eslint/no-explicit-any */
import { DurableLogData, DurableLogLevel } from "./logger";

export interface DurableLoggingContext {
  getDurableLogData: () => DurableLogData;
}

export interface DurableLogger {
  /**
   * Generic log method with configurable level
   * @param level - Log level (e.g., "INFO", "ERROR", "WARN", "DEBUG")
   * @param message - Log message
   * @param optionalParams - Additional data to include in log entry
   * @example context.logger.log("INFO", "User logged in", \{ userId: "XXX" \})
   */
  log?(level: `${DurableLogLevel}`, ...params: any): void;

  /**
   * Log error messages with optional message and additional parameters
   * @param message - Optional message
   * @param optionalParams - Additional data to include in log entry
   * @example context.logger.error("Database query failed", dbError, \{ query: "SELECT * FROM users" \})
   */
  error(...params: any): void;

  /**
   * Log warning messages with optional additional parameters
   * @param message - Optional message
   * @param optionalParams - Additional data to include in log entry
   * @example context.logger.warn("Rate limit approaching", \{ currentRate: 95, limit: 100 \})
   */
  warn(...params: any): void;

  /**
   * Log informational messages with optional additional parameters
   * @param message - Optional message
   * @param optionalParams - Additional data to include in log entry
   * @example context.logger.info("User action completed", \{ userId: "123", action: "login" \})
   */
  info(...params: any): void;

  /**
   * Log debug messages with optional additional parameters
   * @param message - Optional message
   * @param optionalParams - Additional data to include in log entry
   * @example context.logger.debug("Processing step", \{ stepName: "validation", duration: 150 \})
   */
  debug(...params: any): void;

  /**
   * This function will be called by the language SDK before logging any records. The durableLoggingContext
   * can be stored and used by custom loggers to implement mode-aware logging, or logging of custom durable metadata
   * such as operationId, attempt, executionArn, etc.
   * @param durableLoggingContext - The logging context provided by the Durable Execution Language SDK
   */
  configureDurableLoggingContext?(
    durableLoggingContext: DurableLoggingContext,
  ): void;
}

export type DurableContextLogger<Logger extends DurableLogger> = Pick<
  Logger,
  "log" | "warn" | "info" | "error" | "debug"
>;
