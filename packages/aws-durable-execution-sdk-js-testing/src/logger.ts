/**
 * Enum representing different log levels
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4, // Used to disable logging
}

/**
 * Interface for the logger configuration
 */
export interface LoggerConfig {
  /**
   * Minimum log level to output
   * @default LogLevel.INFO
   */
  level?: LogLevel;

  /**
   * Include timestamp in logs
   * @default true
   */
  timestamp?: boolean;

  /**
   * Include log level in output
   * @default true
   */
  showLevel?: boolean;

  /**
   * Custom prefix for log messages
   */
  prefix?: string;
}

/**
 * A configurable logger for the Durable Executions TypeScript Testing Library
 */
export class Logger {
  private level: LogLevel;
  private timestamp: boolean;
  private showLevel: boolean;
  private prefix: string;

  /**
   * Creates a new Logger instance
   * @param config - Configuration options for the logger
   */
  constructor(config: LoggerConfig = {}) {
    this.level = config.level ?? LogLevel.INFO;
    this.timestamp = config.timestamp ?? true;
    this.showLevel = config.showLevel ?? true;
    this.prefix = config.prefix ?? "";
  }

  /**
   * Updates the logger configuration
   * @param config - New configuration options
   */
  public configure(config: Partial<LoggerConfig>): void {
    if (config.level !== undefined) this.level = config.level;
    if (config.timestamp !== undefined) this.timestamp = config.timestamp;
    if (config.showLevel !== undefined) this.showLevel = config.showLevel;
    if (config.prefix !== undefined) this.prefix = config.prefix;
  }

  /**
   * Logs a debug message
   * @param message - The message to log
   * @param optionalParams - Additional parameters to log
   */
  public debug(message: string, ...optionalParams: unknown[]): void {
    this.log(LogLevel.DEBUG, message, optionalParams);
  }

  /**
   * Logs an info message
   * @param message - The message to log
   * @param optionalParams - Additional parameters to log
   */
  public info(message: string, ...optionalParams: unknown[]): void {
    this.log(LogLevel.INFO, message, optionalParams);
  }

  /**
   * Logs a warning message
   * @param message - The message to log
   * @param optionalParams - Additional parameters to log
   */
  public warn(message: string, ...optionalParams: unknown[]): void {
    this.log(LogLevel.WARN, message, optionalParams);
  }

  /**
   * Logs an error message
   * @param message - The message to log
   * @param optionalParams - Additional parameters to log
   */
  public error(message: string, ...optionalParams: unknown[]): void {
    this.log(LogLevel.ERROR, message, optionalParams);
  }

  /**
   * Creates a child logger with an additional prefix
   * @param prefix - The prefix to add to log messages
   * @returns A new logger instance with the combined prefix
   */
  public child(prefix: string): Logger {
    const childLogger = new Logger({
      level: this.level,
      timestamp: this.timestamp,
      showLevel: this.showLevel,
      prefix: this.prefix ? `${this.prefix}:${prefix}` : prefix,
    });

    return childLogger;
  }

  /**
   * Internal method to log a message with the specified level
   * @param level - The log level
   * @param message - The message to log
   * @param optionalParams - Additional parameters to log
   */
  private log(
    level: LogLevel,
    message: string,
    optionalParams: unknown[],
  ): void {
    if (level < this.level) {
      return;
    }

    const parts: string[] = [];

    if (this.timestamp) {
      parts.push(`[${new Date().toISOString()}]`);
    }

    if (this.showLevel) {
      parts.push(`[${LogLevel[level]}]`);
    }

    if (this.prefix) {
      parts.push(`[${this.prefix}]`);
    }

    const formattedMessage =
      parts.length > 0 ? `${parts.join(" ")} ${message}` : message;

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(formattedMessage, ...optionalParams);
        break;
      case LogLevel.INFO:
        console.info(formattedMessage, ...optionalParams);
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage, ...optionalParams);
        break;
      case LogLevel.ERROR:
        console.error(formattedMessage, ...optionalParams);
        break;
    }
  }
}

export function getLogLevel(logLevelString: keyof typeof LogLevel): LogLevel {
  switch (logLevelString) {
    case "DEBUG":
      return LogLevel.DEBUG;
    case "INFO":
      return LogLevel.INFO;
    case "WARN":
      return LogLevel.WARN;
    case "ERROR":
      return LogLevel.ERROR;
    case "NONE":
      return LogLevel.NONE;
    default:
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Invalid log level: ${logLevelString}`);
  }
}

/**
 * The default global logger instance
 */
export const defaultLogger = new Logger({
  level: getLogLevel(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    (process.env.LOG_LEVEL as keyof typeof LogLevel | undefined) ?? "ERROR",
  ),
});
