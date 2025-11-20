/* eslint-disable no-console */

export const log = (message: string, data?: unknown): void => {
  if (process.env.DURABLE_EXAMPLES_VERBOSE === "true") {
    console.log(message, data !== undefined ? data : "");
  }
};
