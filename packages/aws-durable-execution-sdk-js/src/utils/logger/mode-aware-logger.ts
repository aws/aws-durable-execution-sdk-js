import { Logger, DurableExecutionMode } from "../../types";

export const createModeAwareLogger = (
  durableExecutionMode: DurableExecutionMode,
  createContextLogger: (stepId: string, attempt?: number) => Logger,
  modeAwareEnabled: boolean,
  stepPrefix?: string,
): Logger => {
  // Use context logger factory with stepPrefix as step ID (or undefined for top level)
  const enrichedLogger = createContextLogger(stepPrefix || "", undefined);

  // Only log if in ExecutionMode (when mode-aware is enabled) or always log (when disabled)
  const shouldLog = (): boolean =>
    !modeAwareEnabled ||
    durableExecutionMode === DurableExecutionMode.ExecutionMode;

  return {
    log: enrichedLogger.log
      ? (
          level: string,
          message?: string,
          data?: unknown,
          error?: Error,
        ): void => {
          if (shouldLog()) enrichedLogger.log!(level, message, data, error);
        }
      : undefined,
    info: (message?: string, data?: unknown): void => {
      if (shouldLog()) enrichedLogger.info(message, data);
    },
    error: (message?: string, error?: Error, data?: unknown): void => {
      if (shouldLog()) enrichedLogger.error(message, error, data);
    },
    warn: (message?: string, data?: unknown): void => {
      if (shouldLog()) enrichedLogger.warn(message, data);
    },
    debug: (message?: string, data?: unknown): void => {
      if (shouldLog()) enrichedLogger.debug(message, data);
    },
  };
};
