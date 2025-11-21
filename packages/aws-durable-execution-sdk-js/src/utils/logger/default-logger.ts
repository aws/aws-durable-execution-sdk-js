import { Logger } from "../../types";

/**
 * Creates a default logger that outputs structured logs to console.
 * Used as fallback when no custom logger is provided.
 * Always expects structured data from context logger.
 * 
 * Note: _message parameters are unused because the message is already included
 * in the structured data object. Parameters are kept for Logger interface compatibility.
 */
/* eslint-disable no-console */
export const createDefaultLogger = (): Logger => ({
  log: (_level: string, _message?: string, data?: unknown, _error?: Error): void => {
    console.log(data);
  },
  info: (_message?: string, data?: unknown): void => {
    console.info(data);
  },
  error: (_message?: string, _error?: Error, data?: unknown): void => {
    console.error(data);
  },
  warn: (_message?: string, data?: unknown): void => {
    console.warn(data);
  },
  debug: (_message?: string, data?: unknown): void => {
    console.debug(data);
  },
});
/* eslint-enable no-console */
