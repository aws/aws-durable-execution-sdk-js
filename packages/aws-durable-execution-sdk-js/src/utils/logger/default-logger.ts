import { Console } from "node:console";
import { DurableLogLevel, DurableLogData } from "../../types";
import util from "node:util";
import {
  DurableLogger,
  DurableLoggingContext,
} from "../../types/durable-logger";

export interface LoggingExecutionContext {
  durableExecutionArn: string;
  requestId: string;
  tenantId: string | undefined;
}

type DurableLogField = unknown;

/**
 * Log entry that is emitted by the default logger.
 */
interface DefaultDurableLogEntry extends DurableLogData {
  /**
   * Message property is used for all the parameters that the customer passes to the default logger
   */
  message?: unknown;
  errorType?: string;
  errorMessage?: string;
  stackTrace?: string[];

  level: DurableLogLevel;
  timestamp: string;
}

// The logic from this file is based on the NodeJS RIC LogPatch functionality for parity with standard Lambda functions. We should always
// align the default behaviour of how logs are emitted to match the RIC logging behaviour for consistency.
// For custom logic, users can implement their own logger to log data differently.
// See: https://github.com/aws/aws-lambda-nodejs-runtime-interface-client/blob/962ed28eefbc052389c4de4366b1c0c49ee08a13/src/LogPatch.js

/**
 * JSON.stringify replacer function for Error objects.
 * Based on AWS Lambda Runtime Interface Client LogPatch functionality.
 * Transforms Error instances into serializable objects with structured error information,
 * emulating the default Node.js console behavior in Lambda environments.
 *
 * @param _key - The property key (unused in this replacer)
 * @param value - The value being stringified
 * @returns The original value, or a structured error object for Error instances
 */
function jsonErrorReplacer(
  _key: string,
  value: DurableLogField,
): DurableLogField {
  if (value instanceof Error) {
    return Object.assign(
      {
        errorType: value?.constructor?.name ?? "UnknownError",
        errorMessage: value.message,
        stackTrace:
          typeof value.stack === "string"
            ? value.stack.split("\n")
            : value.stack,
      },
      value,
    );
  }
  return value;
}

/**
 * Formats durable log data into structured JSON string output.
 * Emulates AWS Lambda Runtime Interface Client's formatJsonMessage functionality
 * to provide consistent logging format with standard Lambda functions.
 *
 * The function handles two main scenarios:
 * 1. Single parameter: Attempts to stringify directly, falls back to util.format on error
 * 2. Multiple parameters: Uses util.format to create message, extracts error details if present
 *
 * This approach mirrors the RIC's behavior of:
 * - Using util.format for message formatting (same as console.log)
 * - Handling circular references gracefully with fallback formatting
 * - Extracting structured error information when Error objects are present
 * - Including optional tenantId when available
 *
 * @param level - The log level for this message
 * @param logData - Durable execution context data (requestId, executionArn, etc.)
 * @param messageParams - Variable number of message parameters to log
 * @returns JSON string representation of the structured log entry
 */
function formatDurableLogData(
  level: DurableLogLevel,
  logData: DurableLogData,
  ...messageParams: DurableLogField[]
): string {
  const result: DefaultDurableLogEntry = {
    requestId: logData.requestId,
    timestamp: new Date().toISOString(),
    level: level.toUpperCase() as DefaultDurableLogEntry["level"],
    executionArn: logData.executionArn,
  };

  const tenantId = logData.tenantId;
  if (tenantId != undefined && tenantId != null) {
    result.tenantId = tenantId;
  }

  if (logData.operationId !== undefined) {
    result.operationId = logData.operationId;
  }

  if (logData.attempt !== undefined) {
    result.attempt = logData.attempt;
  }

  if (messageParams.length === 1) {
    result.message = messageParams[0];
    try {
      return JSON.stringify(result, jsonErrorReplacer);
    } catch (_) {
      result.message = util.format(result.message);
      return JSON.stringify(result);
    }
  }

  result.message = util.format(...messageParams);
  for (const param of messageParams) {
    if (param instanceof Error) {
      result.errorType = param?.constructor?.name ?? "UnknownError";
      result.errorMessage = param.message;
      result.stackTrace =
        typeof param.stack === "string" ? param.stack.split("\n") : [];
      break;
    }
  }
  return JSON.stringify(result);
}

/**
 * Default logger class that outputs structured logs to console.
 *
 * This logger emulates the AWS Lambda Runtime Interface Client (RIC) console patching
 * behavior to maintain parity with standard Lambda function logging while providing
 * structured output suitable for durable execution contexts.
 *
 * Key RIC behavior emulation:
 * - Respects AWS_LAMBDA_LOG_LEVEL environment variable for log filtering
 * - Uses priority-based level filtering (DEBUG=2, INFO=3, WARN=4, ERROR=5)
 * - Outputs structured JSON with timestamp, requestId, executionArn, and other metadata
 * - Handles Error objects with structured error information extraction
 * - Uses Node.js Console instance for proper stdout/stderr routing
 * - Applies util.format for message formatting (same as console.log behavior)
 *
 * Individual logger methods (info, error, warn, debug) are dynamically enabled/disabled
 * based on the configured log level, defaulting to no-op functions when disabled.
 * This mirrors how RIC patches console methods conditionally.
 */
export class DefaultLogger implements DurableLogger {
  private consoleLogger: Console;
  private durableLoggingContext: DurableLoggingContext | undefined = undefined;
  private executionContext: LoggingExecutionContext | undefined;
  private noOpLog = (): void => {};

  constructor(executionContext?: LoggingExecutionContext) {
    this.executionContext = executionContext;

    // Override the RIC logger to provide custom attributes on the structured log output
    this.consoleLogger = new Console({
      stdout: process.stdout,
      stderr: process.stderr,
    });

    // Initialize methods with no-op and then configure based on log level
    this.info = this.noOpLog;
    this.error = this.noOpLog;
    this.warn = this.noOpLog;
    this.debug = this.noOpLog;

    this.configureLogLevel();
  }

  private configureLogLevel(): void {
    const levels = {
      DEBUG: { name: "DEBUG", priority: 2 },
      INFO: { name: "INFO", priority: 3 },
      WARN: { name: "WARN", priority: 4 },
      ERROR: { name: "ERROR", priority: 5 },
      // Not implemented yet. Can be implemented later
      // TRACE: { name: "TRACE", priority: 1 },
      // FATAL: { name: "FATAL", priority: 6 },
    };

    const logLevelEnvVariable =
      process.env["AWS_LAMBDA_LOG_LEVEL"]?.toUpperCase();
    // Default to DEBUG level when env var is invalid/missing
    const lambdaLogLevel =
      logLevelEnvVariable && logLevelEnvVariable in levels
        ? levels[logLevelEnvVariable as keyof typeof levels]
        : levels.DEBUG;

    // Enable methods based on priority: higher priority = more restrictive
    // e.g., if WARN is set (priority 4), only WARN and ERROR methods are enabled
    if (levels.DEBUG.priority >= lambdaLogLevel.priority) {
      this.debug = (
        message?: DurableLogField,
        ...optionalParams: DurableLogField[]
      ): void => {
        const loggingContext = this.ensureDurableLoggingContext();
        const params =
          message !== undefined ? [message, ...optionalParams] : optionalParams;
        this.consoleLogger.debug(
          formatDurableLogData(
            DurableLogLevel.DEBUG,
            loggingContext.getDurableLogData(),
            ...params,
          ),
        );
      };
    }

    if (levels.INFO.priority >= lambdaLogLevel.priority) {
      this.info = (
        message?: DurableLogField,
        ...optionalParams: DurableLogField[]
      ): void => {
        const loggingContext = this.ensureDurableLoggingContext();
        const params =
          message !== undefined ? [message, ...optionalParams] : optionalParams;
        this.consoleLogger.info(
          formatDurableLogData(
            DurableLogLevel.INFO,
            loggingContext.getDurableLogData(),
            ...params,
          ),
        );
      };
    }

    if (levels.WARN.priority >= lambdaLogLevel.priority) {
      this.warn = (
        message?: DurableLogField,
        ...optionalParams: DurableLogField[]
      ): void => {
        const loggingContext = this.ensureDurableLoggingContext();
        const params =
          message !== undefined ? [message, ...optionalParams] : optionalParams;
        this.consoleLogger.warn(
          formatDurableLogData(
            DurableLogLevel.WARN,
            loggingContext.getDurableLogData(),
            ...params,
          ),
        );
      };
    }

    if (levels.ERROR.priority >= lambdaLogLevel.priority) {
      this.error = (
        message?: DurableLogField,
        ...optionalParams: DurableLogField[]
      ): void => {
        const loggingContext = this.ensureDurableLoggingContext();
        const params =
          message !== undefined ? [message, ...optionalParams] : optionalParams;
        this.consoleLogger.error(
          formatDurableLogData(
            DurableLogLevel.ERROR,
            loggingContext.getDurableLogData(),
            ...params,
          ),
        );
      };
    }
  }

  private ensureDurableLoggingContext(): DurableLoggingContext {
    const context = this.executionContext;

    if (!this.durableLoggingContext && !context) {
      throw new Error(
        "DurableLoggingContext is not configured. Please call configureDurableLoggingContext before logging.",
      );
    }

    if (this.durableLoggingContext) {
      return this.durableLoggingContext;
    }

    if (!context) {
      throw new Error("Execution context is not provided.");
    }

    return {
      getDurableLogData: (): DurableLogData => {
        return {
          requestId: context.requestId,
          executionArn: context.durableExecutionArn,
          tenantId: context.tenantId,
        };
      },
    };
  }

  log(
    level: `${DurableLogLevel}`,
    message?: DurableLogField,
    ...optionalParams: DurableLogField[]
  ): void {
    switch (level) {
      case DurableLogLevel.DEBUG:
        this.debug(message, ...optionalParams);
        break;
      case DurableLogLevel.INFO:
        this.info(message, ...optionalParams);
        break;
      case DurableLogLevel.WARN:
        this.warn(message, ...optionalParams);
        break;
      case DurableLogLevel.ERROR:
        this.error(message, ...optionalParams);
        break;
      default:
        this.info(message, ...optionalParams);
        break;
    }
  }

  // These method signatures will be set dynamically in configureLogLevel()
  info: (
    message?: DurableLogField,
    ...optionalParams: DurableLogField[]
  ) => void;
  error: (
    message?: DurableLogField,
    ...optionalParams: DurableLogField[]
  ) => void;
  warn: (
    message?: DurableLogField,
    ...optionalParams: DurableLogField[]
  ) => void;
  debug: (
    message?: DurableLogField,
    ...optionalParams: DurableLogField[]
  ) => void;

  configureDurableLoggingContext(
    durableLoggingContext: DurableLoggingContext,
  ): void {
    this.durableLoggingContext = durableLoggingContext;
  }
}

/**
 * Creates a default logger that outputs structured logs to console.
 *
 * @param executionContext - Optional execution context for logging
 * @returns DefaultLogger instance
 */
export const createDefaultLogger = (
  executionContext?: LoggingExecutionContext,
): DurableLogger => {
  return new DefaultLogger(executionContext);
};
