import { DurableContext, RetryDecision } from "../../types";
import { Serdes, SerdesContext } from "../../utils/serdes/serdes";
import { DurablePromise } from "../../utils/durable-promise/durable-promise";

// Minimal error decoration for Promise.allSettled results
function decorateErrors<T>(
  value: PromiseSettledResult<T>[],
): PromiseSettledResult<T>[] {
  return value.map((item) => {
    if (item && item.status === "rejected" && item.reason instanceof Error) {
      return {
        ...item,
        reason: {
          message: item.reason.message,
          name: item.reason.name,
          stack: item.reason.stack,
        },
      };
    }
    return item;
  });
}

// Error restoration for Promise.allSettled results
function restoreErrors<T>(
  value: PromiseSettledResult<T>[],
): PromiseSettledResult<T>[] {
  return value.map((item) => {
    if (
      item &&
      item.status === "rejected" &&
      item.reason &&
      typeof item.reason === "object" &&
      item.reason.message
    ) {
      const error = new Error(item.reason.message);
      error.name = item.reason.name || "Error";
      if (item.reason.stack) error.stack = item.reason.stack;
      return {
        ...item,
        reason: error,
      };
    }
    return item;
  });
}

// Custom serdes for promise results with error handling
function createErrorAwareSerdes<T>(): Serdes<PromiseSettledResult<T>[]> {
  return {
    serialize: async (
      value: PromiseSettledResult<T>[] | undefined,
      _context: SerdesContext,
    ): Promise<string | undefined> =>
      value !== undefined ? JSON.stringify(decorateErrors(value)) : undefined,
    deserialize: async (
      data: string | undefined,
      _context: SerdesContext,
    ): Promise<PromiseSettledResult<T>[] | undefined> =>
      data !== undefined
        ? (restoreErrors(JSON.parse(data)) as PromiseSettledResult<T>[])
        : undefined,
  };
}

// No-retry strategy for promise combinators
const stepConfig = {
  retryStrategy: (): RetryDecision => ({
    shouldRetry: false,
  }),
};

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const createPromiseHandler = (step: DurableContext["step"]) => {
  const parseParams = <T>(
    nameOrPromises: string | undefined | Promise<T>[],
    maybePromises?: Promise<T>[],
  ): { name: string | undefined; promises: Promise<T>[] } => {
    if (typeof nameOrPromises === "string" || nameOrPromises === undefined) {
      return { name: nameOrPromises, promises: maybePromises! };
    }
    return { name: undefined, promises: nameOrPromises };
  };

  const all = <T>(
    nameOrPromises: string | undefined | Promise<T>[],
    maybePromises?: Promise<T>[],
  ): Promise<T[]> => {
    const { name, promises } = parseParams(nameOrPromises, maybePromises);
    return step(name, () => Promise.all(promises), stepConfig);
  };

  const allSettled = <T>(
    nameOrPromises: string | undefined | Promise<T>[],
    maybePromises?: Promise<T>[],
  ): Promise<PromiseSettledResult<T>[]> => {
    const { name, promises } = parseParams(nameOrPromises, maybePromises);
    return step(name, () => Promise.allSettled(promises), {
      ...stepConfig,
      serdes: createErrorAwareSerdes<T>(),
    });
  };

  const any = <T>(
    nameOrPromises: string | undefined | Promise<T>[],
    maybePromises?: Promise<T>[],
  ): Promise<T> => {
    const { name, promises } = parseParams(nameOrPromises, maybePromises);
    return step(name, () => Promise.any(promises), stepConfig);
  };

  const race = <T>(
    nameOrPromises: string | undefined | Promise<T>[],
    maybePromises?: Promise<T>[],
  ): Promise<T> => {
    const { name, promises } = parseParams(nameOrPromises, maybePromises);
    return step(name, () => Promise.race(promises), stepConfig);
  };

  return {
    all,
    allSettled,
    any,
    race,
  };
};
