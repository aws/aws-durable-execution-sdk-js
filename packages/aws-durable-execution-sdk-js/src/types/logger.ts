import { DurableContextLogger, DurableLogger } from "./durable-logger";

/**
 * Log data passed to the enriched durable logger
 */
export interface DurableLogData {
  requestId: string;
  executionArn: string;
  tenantId?: string;
  operationId?: string;
  attempt?: number;
  // We aren't attaching any additional properties, but this is
  // added for type-compatibility with popular loggers like powertools
  [key: string]: unknown;
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
export interface LoggerConfig<Logger extends DurableLogger> {
  /**
   * Custom logger implementation to use instead of the default console logger
   */
  customLogger?: Logger;

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
export interface OperationContext<Logger extends DurableLogger> {
  logger: Logger; // Basic durable logger which will be parsed by the enriched durable logger
}

export type StepContext<Logger extends DurableLogger> = OperationContext<
  DurableContextLogger<Logger>
>;
export type WaitForConditionContext<Logger extends DurableLogger> =
  OperationContext<DurableContextLogger<Logger>>;
export type WaitForCallbackContext<Logger extends DurableLogger> =
  OperationContext<DurableContextLogger<Logger>>;
