import { Logger } from "../../types";

/**
 * Creates a default logger that outputs to console.
 * Used as fallback when no custom logger is provided.
 */
/* eslint-disable no-console */
export const createDefaultLogger = (): Logger => ({
  log: (level: string, message?: string, data?: unknown, error?: Error) =>
    console.log(level, message, data, error),
  info: (message?: string, data?: unknown) =>
    console.log("info", message, data),
  error: (message?: string, error?: Error, data?: unknown) =>
    console.log("error", message, error, data),
  warn: (message?: string, data?: unknown) =>
    console.log("warn", message, data),
  debug: (message?: string, data?: unknown) =>
    console.log("debug", message, data),
});
/* eslint-enable no-console */
