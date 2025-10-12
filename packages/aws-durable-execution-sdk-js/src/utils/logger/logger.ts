/* eslint-disable no-console */

export const log = (emoji: string, message: string, data?: unknown): void => {
  if (process.env.DURABLE_VERBOSE_MODE === "true") {
    console.log(
      `${emoji} ${message}`,
      data ? JSON.stringify(data, null, 2) : "",
    );
  }
};
