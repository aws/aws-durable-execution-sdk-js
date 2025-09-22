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
      data?: any,
      error?: Error,
    ) => ({
      timestamp: new Date().toISOString(),
      execution_arn: executionContext.durableExecutionArn,
      step_id: stepId,
      ...(attempt !== undefined && { attempt }),
      level,
      ...(message && { message }),
      ...(data && { data }),
      ...(error && {
        error: { name: error.name, message: error.message, stack: error.stack },
      }),
    });

    return {
      log: (level: string, message?: string, data?: any, error?: Error) => {
        baseLogger.log(
          level,
          message,
          createLogEntry(level, message, data, error),
          error,
        );
      },
      info: (message?: string, data?: any) => {
        baseLogger.info(message, createLogEntry("info", message, data));
      },
      error: (message?: string, error?: Error, data?: any) => {
        baseLogger.error(
          message,
          error,
          createLogEntry("error", message, data, error),
        );
      },
      warn: (message?: string, data?: any) => {
        baseLogger.warn(message, createLogEntry("warn", message, data));
      },
      debug: (message?: string, data?: any) => {
        baseLogger.debug(message, createLogEntry("debug", message, data));
      },
    };
  };
};
