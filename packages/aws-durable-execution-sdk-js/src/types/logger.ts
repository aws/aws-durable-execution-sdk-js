import { EnrichedDurableLogger } from "./enriched-durable-logger";
import { DurableLogger } from "./durable-logger";

/**
 * Log data passed to the enriched durable logger
 */
export interface DurableLogData {
  requestId: string;
  timestamp: string;
  level: `${DurableLogLevel}`;
  executionArn: string;
  tenantId?: string;
  operationId?: string;
  attempt?: number;
}

/**
 * Log level supported by the durable logger
 */
export enum DurableLogLevel {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  DEBUG = "DEBUG",
}

/**
 * Configuration options for logger behavior
 *
 * This interface supports partial configuration - you can provide only the properties
 * you want to update. Omitted properties will retain their current values.
 */
export interface LoggerConfig {
  /**
   * Custom logger implementation to use instead of the default console logger
   */
  customLogger?: EnrichedDurableLogger;

  /**
   * Whether to enable mode-aware logging (suppress logs during replay)
   * @defaultValue true
   */
  modeAware?: boolean;
}

/**
 * Base interface for operation contexts.
 * Do not use directly - use specific context types like StepContext, WaitForConditionContext, etc.
 */
export interface OperationContext {
  logger: DurableLogger; // Basic durable logger which will be parsed by the enriched durable logger
}

export type StepContext = OperationContext;
export type WaitForConditionContext = OperationContext;
export type WaitForCallbackContext = OperationContext;
