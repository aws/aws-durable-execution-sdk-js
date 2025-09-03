import { hashId } from "../step-id-utils/step-id-utils";
import { Logger } from "../../types";

export interface LogContext {
  stepId?: string;
  executionId: string;
  attempt?: number;
}

export interface StructuredLogger {
  log(message?: string, data?: any): void;
  error(message?: string, error?: Error, data?: any): void;
  warn(message?: string, data?: any): void;
  info(message?: string, data?: any): void;
  debug(message?: string, data?: any): void;
}

// Global custom logger instance
let customLogger: Logger | null = null;

export const setCustomLogger = (logger: Logger | null): void => {
  customLogger = logger;
};

export const createStructuredLogger = (
  context: LogContext,
): StructuredLogger => {
  const logWithContext = (
    level: string,
    message?: string,
    data?: any,
    error?: Error,
  ) => {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      ...(message && { message }),
      execution_id: context.executionId,
      ...(context.stepId && { step_id: hashId(context.stepId) }),
      ...(context.attempt !== undefined && {
        attempt: context.attempt,
      }),
      ...(data && { data }),
      ...(error && {
        error: { name: error.name, message: error.message, stack: error.stack },
      }),
    };

    console.log(JSON.stringify(logEntry));
  };

  return {
    log: (message?: string, data?: any) => {
      if (customLogger) {
        customLogger.info(message, data);
        return;
      }
      logWithContext("info", message, data);
    },
    error: (message?: string, error?: Error, data?: any) => {
      if (customLogger) {
        customLogger.error(message, error, data);
        return;
      }
      logWithContext("error", message, data, error);
    },
    warn: (message?: string, data?: any) => {
      if (customLogger) {
        customLogger.warn(message, data);
        return;
      }
      logWithContext("warn", message, data);
    },
    info: (message?: string, data?: any) => {
      if (customLogger) {
        customLogger.info(message, data);
        return;
      }
      logWithContext("info", message, data);
    },
    debug: (message?: string, data?: any) => {
      if (customLogger) {
        customLogger.debug(message, data);
        return;
      }
      logWithContext("debug", message, data);
    },
  };
};
