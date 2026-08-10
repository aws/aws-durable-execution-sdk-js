import * as asyncHooks from "async_hooks";
import type { DurableLogger } from "../../types/durable-logger";

/**
 * The subset of `AsyncLocalStorage` this package uses.
 *
 * @internal
 */
export interface ContextStorage<T> {
  run<R>(store: T, fn: () => R): R;
  getStore(): T | undefined;
}

/**
 * Fallback used on runtimes whose `async_hooks` has no `AsyncLocalStorage`.
 *
 * Lightweight JavaScript runtimes targeting Lambda — LLRT, for example — implement only the
 * low-level `async_hooks` surface. A polyfill is not possible there either: those runtimes
 * emit `init` for promise resources but no `before`/`after`, so there is no callback in which
 * to reinstate a store when a promise continuation runs.
 *
 * This fallback keeps the store for the synchronous portion of `run()`, including nested
 * `run()` frames entered synchronously, and reports `undefined` — "unknown" — once `fn`
 * suspends. Reporting `undefined` rather than a stale value is the important property:
 * `validateContextUsage` skips when there is no active context, whereas a stale store would
 * make it terminate a perfectly correct execution.
 *
 * What degrades on such a runtime is observability, not checkpoint/replay correctness:
 * log records emitted after an `await` lose `operationId`/`operationName`/`attempt`,
 * mode-aware logging cannot suppress replayed lines, and context misuse is only detected
 * when it occurs synchronously. The `no-nested-durable-operations` rule in
 * `@aws/durable-execution-sdk-js-eslint-plugin` catches the remaining cases statically.
 *
 * @internal
 */
export class SynchronousContextStorage<T> implements ContextStorage<T> {
  private store: T | undefined = undefined;

  run<R>(store: T, fn: () => R): R {
    const previous = this.store;
    this.store = store;
    try {
      return fn();
    } finally {
      this.store = previous;
    }
  }

  getStore(): T | undefined {
    return this.store;
  }
}

/**
 * Creates the context storage for the current runtime, preferring the runtime's own
 * `AsyncLocalStorage` and falling back when it is absent.
 *
 * @internal
 */
export const createContextStorage = <T>(): ContextStorage<T> => {
  const AsyncLocalStorage = (asyncHooks as Partial<typeof asyncHooks>)
    .AsyncLocalStorage;
  if (AsyncLocalStorage) {
    return new AsyncLocalStorage<T>();
  }
  contextStorageIsDegraded = true;
  return new SynchronousContextStorage<T>();
};

let contextStorageIsDegraded = false;
let degradationWarningEmitted = false;

/**
 * Whether the fallback storage is in use, meaning async context tracking is degraded.
 *
 * @internal
 */
export const isContextStorageDegraded = (): boolean => contextStorageIsDegraded;

/**
 * Warns once per execution environment when the fallback storage is in use.
 *
 * The fallback is silent about *which* context is active outside synchronous code, and it is
 * better for that to be stated than inferred from a missing `operationId`. Emitted once per
 * process rather than once per invocation: the condition is a property of the runtime, so
 * repeating it on every replay would be noise.
 *
 * @internal
 */
export const warnOnceIfContextStorageIsDegraded = (
  logger: Pick<DurableLogger, "warn">,
): void => {
  if (!contextStorageIsDegraded || degradationWarningEmitted) {
    return;
  }
  degradationWarningEmitted = true;
  logger.warn(
    "This runtime does not provide AsyncLocalStorage, so the SDK cannot track which " +
      "durable operation is active across await boundaries. Checkpointing and replay are " +
      "unaffected. Degraded: log records emitted after an await lose operationId, " +
      "operationName and attempt; replayed log records are no longer suppressed; and using " +
      "a parent or sibling context inside runInChildContext is only detected when it " +
      "happens synchronously. Enable the no-nested-durable-operations rule from " +
      "@aws/durable-execution-sdk-js-eslint-plugin to catch the remaining cases at build " +
      "time.",
  );
};

/**
 * Resets the module-level warning state. Test-only.
 *
 * @internal
 */
export const resetContextStorageDegradationForTesting = (): void => {
  contextStorageIsDegraded = false;
  degradationWarningEmitted = false;
};
