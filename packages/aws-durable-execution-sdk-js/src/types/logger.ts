/**
 * Generic logger interface for custom logger implementations
 * Provides structured logging capabilities for durable execution contexts
 */
export interface Logger {
  /** Generic log method with configurable level (optional for compatibility with popular loggers) */
  log?(level: string, message?: string, data?: unknown, error?: Error): void;
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
 * Configuration options for logger behavior
 *
 * This interface supports partial configuration - you can provide only the properties
 * you want to update. Omitted properties will retain their current values.
 */
export interface LoggerConfig {
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
export interface OperationContext {
  logger: Logger;
}

export type StepContext = OperationContext;
export type WaitForConditionContext = OperationContext;
export type WaitForCallbackContext = OperationContext;
