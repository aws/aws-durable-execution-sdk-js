import {
  DurableContext,
  RetryDecision,
  DurablePromise,
  DurableLogger,
} from "../../types";
import { Serdes, SerdesContext } from "../../utils/serdes/serdes";

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

export const createPromiseHandler = <Logger extends DurableLogger>(
  step: DurableContext<Logger>["step"],
): {
  all: <T>(
    nameOrPromises: string | undefined | DurablePromise<T>[],
    maybePromises?: DurablePromise<T>[],
  ) => DurablePromise<T[]>;
  allSettled: <T>(
    nameOrPromises: string | undefined | DurablePromise<T>[],
    maybePromises?: DurablePromise<T>[],
  ) => DurablePromise<PromiseSettledResult<T>[]>;
  any: <T>(
    nameOrPromises: string | undefined | DurablePromise<T>[],
    maybePromises?: DurablePromise<T>[],
  ) => DurablePromise<T>;
  race: <T>(
    nameOrPromises: string | undefined | DurablePromise<T>[],
    maybePromises?: DurablePromise<T>[],
  ) => DurablePromise<T>;
} => {
  const parseParams = <T>(
    nameOrPromises: string | undefined | DurablePromise<T>[],
    maybePromises?: DurablePromise<T>[],
  ): { name: string | undefined; promises: DurablePromise<T>[] } => {
    if (typeof nameOrPromises === "string" || nameOrPromises === undefined) {
      return {
        name: nameOrPromises as string | undefined,
        promises: maybePromises!,
      };
    }
    return { name: undefined, promises: nameOrPromises };
  };

  const all = <T>(
    nameOrPromises: string | undefined | DurablePromise<T>[],
    maybePromises?: DurablePromise<T>[],
  ): DurablePromise<T[]> => {
    return new DurablePromise(async () => {
      const { name, promises } = parseParams(nameOrPromises, maybePromises);

      // Wrap Promise.all execution in a step for persistence
      return await step(name, () => Promise.all(promises), stepConfig);
    });
  };

  const allSettled = <T>(
    nameOrPromises: string | undefined | DurablePromise<T>[],
    maybePromises?: DurablePromise<T>[],
  ): DurablePromise<PromiseSettledResult<T>[]> => {
    return new DurablePromise(async () => {
      const { name, promises } = parseParams(nameOrPromises, maybePromises);

      // Wrap Promise.allSettled execution in a step for persistence
      return await step(name, () => Promise.allSettled(promises), {
        ...stepConfig,
        serdes: createErrorAwareSerdes<T>(),
      });
    });
  };

  const any = <T>(
    nameOrPromises: string | undefined | DurablePromise<T>[],
    maybePromises?: DurablePromise<T>[],
  ): DurablePromise<T> => {
    return new DurablePromise(async () => {
      const { name, promises } = parseParams(nameOrPromises, maybePromises);

      // Wrap Promise.any execution in a step for persistence
      return await step(name, () => (Promise as any).any(promises), stepConfig);
    });
  };

  const race = <T>(
    nameOrPromises: string | undefined | DurablePromise<T>[],
    maybePromises?: DurablePromise<T>[],
  ): DurablePromise<T> => {
    return new DurablePromise(async () => {
      const { name, promises } = parseParams(nameOrPromises, maybePromises);

      // Wrap Promise.race execution in a step for persistence
      return await step(name, () => Promise.race(promises), stepConfig);
    });
  };

  return {
    all,
    allSettled,
    any,
    race,
  };
};
