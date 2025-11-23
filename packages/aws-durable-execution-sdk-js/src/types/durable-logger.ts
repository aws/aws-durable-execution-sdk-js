/* eslint-disable @typescript-eslint/no-explicit-any */

import { DurableLogLevel } from ".";

/**
 * Base logger interface that users interact with. This logger is attached to the durable
 * and step context and is used to log messages during execution.
 *
 * Custom loggers should implement EnrichedDurableLogger instead of this logger, since EnrichedDurableLogger
 * provides the DurableLogEntry as the first argument to custom log methods.
 *
 * By default, all logs are structured and automatically enriched with execution metadata.
 * such as timestamp, executionArn, operationId, etc.
 */
export interface DurableLogger {
  /**
   * Generic log method with configurable level
   * @param level - Log level (e.g., "INFO", "ERROR", "WARN", "DEBUG")
   * @param message - Log message
   * @param optionalParams - Additional data to include in log entry
   * @example context.logger.log("INFO", "User logged in", \{ userId: "XXX" \})
   */
  log?(
    level: `${DurableLogLevel}`,
    message?: any,
    ...optionalParams: any[]
  ): void;

  /**
   * Log error messages with optional message and additional parameters
   * @param message - Optional message
   * @param optionalParams - Additional data to include in log entry
   * @example context.logger.error("Database query failed", dbError, \{ query: "SELECT * FROM users" \})
   */
  error(message?: any, ...optionalParams: any[]): void;

  /**
   * Log warning messages with optional additional parameters
   * @param message - Optional message
   * @param optionalParams - Additional data to include in log entry
   * @example context.logger.warn("Rate limit approaching", \{ currentRate: 95, limit: 100 \})
   */
  warn(message?: any, ...optionalParams: any[]): void;

  /**
   * Log informational messages with optional additional parameters
   * @param message - Optional message
   * @param optionalParams - Additional data to include in log entry
   * @example context.logger.info("User action completed", \{ userId: "123", action: "login" \})
   */
  info(message?: any, ...optionalParams: any[]): void;

  /**
   * Log debug messages with optional additional parameters
   * @param message - Optional message
   * @param optionalParams - Additional data to include in log entry
   * @example context.logger.debug("Processing step", \{ stepName: "validation", duration: 150 \})
   */
  debug(message?: any, ...optionalParams: any[]): void;
}
