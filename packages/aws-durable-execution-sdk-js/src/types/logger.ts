/**
 * Generic logger interface for custom logger implementations
 * Provides structured logging capabilities for durable execution contexts
 */
export interface Logger {
  /** Generic log method with configurable level */
  log(level: string, message?: string, data?: unknown, error?: Error): void;
  /** Log error messages with optional error object and additional data */
  error(message?: string, error?: Error, data?: unknown): void;
  /** Log warning messages with optional additional data */
  warn(message?: string, data?: unknown): void;
  /** Log informational messages with optional additional data */
  info(message?: string, data?: unknown): void;
  /** Log debug messages with optional additional data */
  debug(message?: string, data?: unknown): void;
}

/**
 * Base interface for operation contexts.
 * Do not use directly - use specific context types like StepContext, WaitForConditionContext, etc.
 */
export interface OperationContext {
  logger: Logger;
}

export type StepContext = OperationContext;
export type WaitForConditionContext = OperationContext;
export type WaitForCallbackContext = OperationContext;
