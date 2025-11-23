import { DurableExecutionMode, DurableLogLevel } from "../../types";
import { DurableLogField, DurableLogger } from "../../types/durable-logger";

export const createModeAwareLogger = (
  durableExecutionMode: DurableExecutionMode,
  createContextLogger: (stepId: string, attempt?: number) => DurableLogger,
  modeAwareEnabled: boolean,
  stepPrefix?: string,
): DurableLogger => {
  // Use context logger factory with stepPrefix as step ID (or undefined for top level)
  const enrichedLogger = createContextLogger(stepPrefix || "", undefined);

  // Only log if in ExecutionMode (when mode-aware is enabled) or always log (when disabled)
  const shouldLog = (): boolean =>
    !modeAwareEnabled ||
    durableExecutionMode === DurableExecutionMode.ExecutionMode;

  const enrichedLog = enrichedLogger.log.bind(enrichedLogger);

  return {
    log: (level: DurableLogLevel, ...params: DurableLogField[]): void => {
      if (shouldLog()) enrichedLog(level, ...params);
    },
    info: (...params: DurableLogField[]): void => {
      if (shouldLog()) enrichedLogger.info(...params);
    },
    error: (...params: DurableLogField[]): void => {
      if (shouldLog()) enrichedLogger.error(...params);
    },
    warn: (...params: DurableLogField[]): void => {
      if (shouldLog()) enrichedLogger.warn(...params);
    },
    debug: (...params: DurableLogField[]): void => {
      if (shouldLog()) enrichedLogger.debug(...params);
    },
  };
};
