/* eslint-disable @typescript-eslint/no-explicit-any */

import { DurableLogLevel, DurableLogData } from "./logger";

/**
 * This interface provides structured logging capabilities for durable execution contexts.
 * The interface is only interacted with by the language SDK, not used by the step
 * and durable context loggers. Those loggers use the `DurableLogger` interface.
 *
 * The first parameter of all log entries for the `EnrichedDurableLogger` are automatically
 * populated with execution metadata (timestamp, executionArn, operationId, etc.). All subsequent
 * parameters are passed directly from the calling code.
 *
 * A custom logger must implement this interface to process durable execution logs.
 */
export interface EnrichedDurableLogger {
  /**
   * Generic log method with configurable level (optional for compatibility with popular loggers)
   * @param level - Log level (e.g., "INFO", "ERROR", "WARN", "DEBUG")
   * @param data - Data created by the language SDK with context about the log entry
   * @param optionalParams - Additional parameters for the log which the user passes directly
   * @example context.logger.log("INFO", "User action completed", \{ userId: "XXX", action: "login" \})
   */
  log?(
    level: `${DurableLogLevel}`,
    data: DurableLogData,
    ...optionalParams: any[]
  ): void;

  /**
   * Log errors with optional error object and additional data
   * @param data - Data created by the language SDK with context about the log entry
   * @param optionalParams - Additional parameters for the log which the user passes directly
   * @example context.logger.error("Database query failed", dbError, \{ query: "SELECT * FROM users" \})
   */
  error(data: DurableLogData, ...optionalParams: any[]): void;

  /**
   * Log warnings with optional additional data
   * @param data - Data created by the language SDK with context about the log entry
   * @param optionalParams - Additional parameters for the log which the user passes directly
   * @example context.logger.warn("Rate limit approaching", \{ currentRate: 95, limit: 100 \})
   */
  warn(data: DurableLogData, ...optionalParams: any[]): void;

  /**
   * Log informational data with optional additional data
   * @param data - Data created by the language SDK with context about the log entry
   * @param optionalParams - Additional parameters for the log which the user passes directly
   * @example context.logger.info("User action completed", \{ userId: "123", action: "login" \})
   */
  info(data: DurableLogData, ...optionalParams: any[]): void;

  /**
   * Log debug messages with optional additional data
   * @param data - Data created by the language SDK with context about the log entry
   * @param optionalParams - Additional parameters for the log which the user passes directly
   * @example context.logger.debug("Processing step", \{ stepName: "validation", duration: 150 \})
   */
  debug(data: DurableLogData, ...optionalParams: any[]): void;
}
