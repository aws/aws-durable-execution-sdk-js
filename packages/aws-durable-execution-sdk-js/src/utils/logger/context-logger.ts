import {
  EnrichedDurableLogger,
  DurableLogLevel,
  DurableLogData,
} from "../../types";
import { hashId } from "../step-id-utils/step-id-utils";
import { DurableLogger } from "../../types/durable-logger";

export interface ContextLoggerContext {
  durableExecutionArn: string;
  requestId: string;
  tenantId: string | undefined;
}

export const createContextLoggerFactory = (
  executionContext: ContextLoggerContext,
  getLogger: () => EnrichedDurableLogger,
) => {
  return (operationId?: string, attempt?: number): DurableLogger => {
    const baseLogger = getLogger();

    const createLogData = (level: DurableLogLevel): DurableLogData => {
      return {
        timestamp: new Date().toISOString(),
        executionArn: executionContext.durableExecutionArn,
        level,
        requestId: executionContext.requestId,
        tenantId: executionContext.tenantId,
        operationId: operationId ? hashId(operationId) : undefined,
        attempt,
      };
    };

    const baseLog = baseLogger.log?.bind(baseLogger);

    return {
      log: baseLog
        ? (level: DurableLogLevel, ...params: unknown[]): void => {
            baseLog(level, createLogData(level), ...params);
          }
        : undefined,
      info: (...params: unknown[]): void => {
        baseLogger.info(createLogData(DurableLogLevel.INFO), ...params);
      },
      error: (...params: unknown[]): void => {
        baseLogger.error(createLogData(DurableLogLevel.ERROR), ...params);
      },
      warn: (...params: unknown[]): void => {
        baseLogger.warn(createLogData(DurableLogLevel.WARN), ...params);
      },
      debug: (...params: unknown[]): void => {
        baseLogger.debug(createLogData(DurableLogLevel.DEBUG), ...params);
      },
    };
  };
};
