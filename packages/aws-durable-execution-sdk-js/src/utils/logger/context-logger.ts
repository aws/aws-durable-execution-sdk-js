import {
  EnrichedDurableLogger,
  DurableLogLevel,
  DurableLogData,
} from "../../types";
import { hashId } from "../step-id-utils/step-id-utils";
import { DurableLogField, DurableLogger } from "../../types/durable-logger";

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

    const createLogData = (): DurableLogData => {
      return {
        executionArn: executionContext.durableExecutionArn,
        requestId: executionContext.requestId,
        tenantId: executionContext.tenantId,
        operationId: operationId ? hashId(operationId) : undefined,
        attempt,
      };
    };

    const baseLog = baseLogger.log?.bind(baseLogger);

    const contextLogger: DurableLogger = {
      log: baseLog
        ? (level: DurableLogLevel, ...params: unknown[]): void => {
            baseLog(level, createLogData(), ...params);
          }
        : (level: DurableLogLevel, ...params: DurableLogField[]): void => {
            switch (level) {
              case DurableLogLevel.INFO:
                contextLogger.info(...params);
                break;
              case DurableLogLevel.WARN:
                contextLogger.warn(...params);
                break;
              case DurableLogLevel.ERROR:
                contextLogger.error(...params);
                break;
              case DurableLogLevel.DEBUG:
                contextLogger.debug(...params);
                break;
              default:
                contextLogger.info(...params);
                break;
            }
          },
      info: (...params: DurableLogField[]): void => {
        baseLogger.info(createLogData(), ...params);
      },
      error: (...params: DurableLogField[]): void => {
        baseLogger.error(createLogData(), ...params);
      },
      warn: (...params: DurableLogField[]): void => {
        baseLogger.warn(createLogData(), ...params);
      },
      debug: (...params: DurableLogField[]): void => {
        baseLogger.debug(createLogData(), ...params);
      },
    };

    return contextLogger;
  };
};
