import { Logger, ExecutionContext } from "../../types";

export const createContextLoggerFactory = (
  executionContext: ExecutionContext,
  getLogger: () => Logger,
) => {
  return (stepId: string, attempt?: number): Logger => {
    const baseLogger = getLogger();

    const createLogEntry = (
      level: string,
      message?: string,
      data?: unknown,
      error?: Error,
    ): Record<string, unknown> => {
      const entry: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        execution_arn: executionContext.durableExecutionArn,
        level,
      };

      if (stepId) entry.step_id = stepId;
      if (attempt !== undefined) entry.attempt = attempt;
      if (message) entry.message = message;
      if (data) entry.data = data;
      if (error) {
        entry.error = {
          name: error.name,
          message: error.message,
          stack: error.stack,
        };
      }

      return entry;
    };

    return {
      log: (
        level: string,
        message?: string,
        data?: unknown,
        error?: Error,
      ): void => {
        baseLogger.log(
          level,
          message,
          createLogEntry(level, message, data, error),
          error,
        );
      },
      info: (message?: string, data?: unknown): void => {
        baseLogger.info(message, createLogEntry("info", message, data));
      },
      error: (message?: string, error?: Error, data?: unknown): void => {
        baseLogger.error(
          message,
          error,
          createLogEntry("error", message, data, error),
        );
      },
      warn: (message?: string, data?: unknown): void => {
        baseLogger.warn(message, createLogEntry("warn", message, data));
      },
      debug: (message?: string, data?: unknown): void => {
        baseLogger.debug(message, createLogEntry("debug", message, data));
      },
    };
  };
};
