import { Logger } from "../../types";

/**
 * Creates a default logger that outputs to console.
 * Used as fallback when no custom logger is provided.
 */
export const createDefaultLogger = (): Logger => ({
  log: (level: string, message?: string, data?: any, error?: Error) =>
    console.log(level, message, data, error),
  info: (message?: string, data?: any) => console.log("info", message, data),
  error: (message?: string, error?: Error, data?: any) =>
    console.log("error", message, error, data),
  warn: (message?: string, data?: any) => console.log("warn", message, data),
  debug: (message?: string, data?: any) => console.log("debug", message, data),
});
