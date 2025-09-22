/* eslint-disable no-console */

export const log = (
  isVerbose: boolean,
  emoji: string,
  message: string,
  data?: unknown,
): void => {
  if (isVerbose) {
    console.log(
      `${emoji} ${message}`,
      data ? JSON.stringify(data, null, 2) : "",
    );
  }
};
