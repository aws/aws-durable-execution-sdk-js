import { DurableContextLogger, DurableLogger } from "./durable-logger";

/**
 * Log data passed to the durable logger when `getDurableLogData` is called.
 * @public
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
 * @public
 */
export enum DurableLogLevel {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  DEBUG = "DEBUG",
}

/**
 * Configuration options for logger behavior
 * @public
 */
export interface LoggerConfig<Logger extends DurableLogger> {
  /**
   * Custom logger implementation to use instead of the default console logger
   * @defaultValue Default console logger
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
 * @public
 */
export interface OperationContext<Logger extends DurableLogger> {
  logger: Logger; // Basic durable logger which will be parsed by the enriched durable logger
}

/**
 * Context for step operations.
 * @public
 */
export type StepContext<Logger extends DurableLogger> = OperationContext<
  DurableContextLogger<Logger>
>;

/**
 * Context for waitForCondition operations.
 * @public
 */
export type WaitForConditionContext<Logger extends DurableLogger> =
  OperationContext<DurableContextLogger<Logger>>;

/**
 * Context for step operations.
 * @public
 */
export type WaitForCallbackContext<Logger extends DurableLogger> =
  OperationContext<DurableContextLogger<Logger>>;
