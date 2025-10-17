/* eslint-disable no-console */
import { safeStringify } from "../safe-stringify/safe-stringify";

export const log = (emoji: string, message: string, data?: unknown): void => {
  if (process.env.DURABLE_VERBOSE_MODE === "true") {
    console.log(`${emoji} ${message}`, data ? safeStringify(data) : "");
  }
};
