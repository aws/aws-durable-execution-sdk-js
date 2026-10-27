import * as asyncHooks from "node:async_hooks";
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
 * The runtime's `AsyncLocalStorage`, if it has one.
 *
 * Resolved once at module scope rather than recorded as a side effect of
 * `createContextStorage()`, so that whether the runtime is degraded does not depend on any
 * module having been evaluated first. The reader of this state
 * (`context/execution-context`) imports this module directly, not through `context-tracker`
 * which is what constructs the storage.
 */
const RuntimeAsyncLocalStorage = (asyncHooks as Partial<typeof asyncHooks>)
  .AsyncLocalStorage;

/**
 * Fallback used on runtimes whose `async_hooks` has no `AsyncLocalStorage`.
 *
 * Lightweight JavaScript runtimes targeting Lambda — LLRT, for example — implement only the
 * low-level `async_hooks` surface. A polyfill built on that surface is not possible either:
 * while `AsyncHook` accepts `before` and `after` callbacks, those are not invoked for promise
 * resources, so there is no callback in which to reinstate a store when a promise continuation
 * runs. Measured on LLRT release v0.8.1-beta (binary reports v0.8.0-beta) with
 * `LLRT_ASYNC_HOOKS=1`: a chain of two awaited async functions plus one timer emits
 * `init` six times for `PROMISE` and never `before` or `after` for any of them, where Node 22
 * emits four and three respectively. Patching `Promise.prototype.then` does not help, since
 * `await` on a native promise never calls it.
 *
 * This fallback keeps the store for the synchronous portion of `run()`, including nested
 * `run()` frames entered synchronously, and reports `undefined` — "unknown" — once `fn`
 * suspends. Reporting `undefined` rather than a stale value is the important property:
 * `validateContextUsage` skips when there is no active context, whereas a stale store would
 * make it terminate a perfectly correct execution.
 *
 * That guarantee depends on how callers use `run()`, not on this class alone. Every current
 * call site passes an async callback whose promise the caller awaits, so `run()` returns — and
 * the store reverts — at the callback's first suspension, leaving no window in which a stale
 * store could be observed. **A caller that re-entered `run()` across a suspension, or resumed
 * one store's callback inside another's synchronous frame, would break that invariant, and
 * nothing here would fail loudly.** Keep the contract: `run()` is for wrapping a callback that
 * either completes synchronously or suspends exactly once, at which point the context is
 * deliberately forgotten.
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
export const createContextStorage = <T>(): ContextStorage<T> =>
  RuntimeAsyncLocalStorage
    ? new RuntimeAsyncLocalStorage<T>()
    : new SynchronousContextStorage<T>();

/**
 * Whether operation-context tracking is degraded, because the runtime has no
 * `AsyncLocalStorage`.
 *
 * @internal
 */
export const isContextStorageDegraded = (): boolean =>
  !RuntimeAsyncLocalStorage;

let degradationWarningEmitted = false;

/**
 * Warns once per execution environment when context tracking is degraded.
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
  if (!isContextStorageDegraded() || degradationWarningEmitted) {
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
