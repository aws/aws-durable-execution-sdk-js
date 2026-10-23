import {
  DurableInstrumentationPlugin,
  AttemptEndInfo,
  AttemptInfo,
  InvocationEndInfo,
  InvocationInfo,
  OperationChangeInfo,
  PropagationInput,
  OperationEndInfo,
  OperationInfo,
  CustomerFnResult,
  CustomerFn,
} from "../../types/plugin";
import { DurableExecutionInvocationOutput } from "../../types/core";
import { MAX_TIMER_DELAY_MS } from "../constants/constants";
import { collectPropagationMetadata } from "./propagation-metadata";

type CallbackResult = unknown;
type CallbackFn = () => CallbackResult;
type PluginInfo =
  | OperationInfo
  | OperationEndInfo
  | InvocationInfo
  | InvocationEndInfo
  | AttemptEndInfo
  | AttemptInfo
  | OperationChangeInfo
  | PropagationInput
  | undefined;
type PluginWrapperHookFn = (
  info: PluginInfo,
  fn: CustomerFnResult,
) => CallbackResult;
type PluginHookFn = (info: PluginInfo) => CallbackResult;

/**
 * Time kept free at the end of an invocation when the drain of earlier hook
 * work runs. Work still pending this close to the deadline is abandoned, so
 * `onInvocationEnd` keeps its time.
 */
export const PLUGIN_DRAIN_RESERVE_MS = 500;

/**
 * Time kept free at the end of an invocation when `onInvocationEnd` runs, so
 * the SDK can still return the Lambda response after it stops waiting.
 */
export const PLUGIN_END_RESERVE_MS = 50;

/**
 * @internal
 */
export interface PluginRunnerOptions {
  /**
   * Remaining time of the invocation, in milliseconds. Bounds the drain in
   * `onInvocationEnd`. Without it, the drain waits for every hook to settle.
   */
  getRemainingTimeMs?: () => number;
}

/**
 * Reads the remaining time without letting the read fail the invocation.
 *
 * The plugin runner reads it on every invocation that has a plugin. A context
 * from another compute, or a stub context in a customer's unit test, may lack
 * the method, throw from it, or return a value that is not a finite number.
 * None of those states a deadline. So each of them counts as no deadline, and
 * the runner waits for every hook to settle, as it would with `Infinity`.
 */
function readRemainingMs(read: (() => number) | undefined): number {
  try {
    const value = read?.();
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : Infinity;
  } catch {
    return Infinity;
  }
}

/**
 * Waits for `promises` to settle, but not past the epoch time `endBy`.
 * The promises must not reject.
 *
 * A single timer is capped at {@link MAX_TIMER_DELAY_MS}. Node runs a longer
 * delay after 1 ms instead. So for a later `endBy` this waits in steps of at
 * most that length.
 */
async function settleBy(
  promises: Promise<void>[],
  endBy: number,
): Promise<void> {
  if (promises.length === 0) return;
  const all = Promise.all(promises).then(() => true);
  if (endBy === Infinity) {
    await all;
    return;
  }
  while (Date.now() < endBy) {
    const delayMs = Math.min(endBy - Date.now(), MAX_TIMER_DELAY_MS);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), delayMs);
    });
    try {
      if (await Promise.race([all, timeout])) return;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Creates a composite plugin runner that dispatches lifecycle events to all registered plugins.
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function createPluginRunner(
  plugins: DurableInstrumentationPlugin[],
  options: PluginRunnerOptions = {},
): DurableInstrumentationPlugin {
  if (plugins.length === 0) return {};

  // Hook work started by fireAndForget that has not settled yet.
  const pending = new Set<Promise<void>>();

  /**
   * Calls `method` on every plugin, in plugin order, and returns one promise
   * per plugin. The synchronous part of each hook runs before this returns.
   * The promises never reject: a hook that throws or rejects is contained.
   */
  const invokeAll = <K extends keyof DurableInstrumentationPlugin>(
    method: K,
    info: Parameters<NonNullable<DurableInstrumentationPlugin[K]>>[0],
  ): Promise<void>[] =>
    plugins
      .map(async (p) => {
        const result = (p[method] as PluginHookFn)?.(info as PluginInfo);
        if (
          result != null &&
          typeof (result as Promise<unknown>).then === "function"
        ) {
          await result;
        }
      })
      .map((promise) => promise.catch(() => undefined));

  const runAsCallback = <K extends keyof DurableInstrumentationPlugin>(
    method: K,
    info: Parameters<NonNullable<DurableInstrumentationPlugin[K]>>[0],
    fn: CustomerFn,
  ): CustomerFnResult => {
    let fnError: { error: unknown } | undefined;
    let fnCalled = false;
    let fnResult: CustomerFnResult;

    // Wrap the original fn to capture any error it throws and prevent double-calls
    const guardedFn: CallbackResult | CustomerFnResult = () => {
      if (fnCalled) return fnResult;
      fnCalled = true;
      try {
        const result: CustomerFnResult = fn();
        if (
          result != null &&
          typeof (result as Promise<unknown>).then === "function"
        ) {
          fnResult = (result as Promise<unknown>).catch((err: unknown) => {
            fnError = { error: err };
            throw err; // re-throw so plugins still see it
          });
          return fnResult;
        }
        fnResult = result;
        return result;
      } catch (err) {
        fnError = { error: err };
        throw err; // re-throw so plugins still see it
      }
    };

    // Each link contains its own wrapper's failure. A wrapper that throws, or
    // whose promise rejects, is a plugin error unless the customer fn failed.
    // The link then falls through to the rest of the chain: it reuses that
    // result if the wrapper already called `next`, and calls `next` if it did
    // not. So a failing wrapper never skips the wrappers inside it, for
    // example the span context another plugin sets up.
    const chain: CallbackFn = plugins.reduceRight<CallbackFn>(
      (next, plugin) => () => {
        const hookFn = plugin[method] as PluginWrapperHookFn;
        if (!hookFn) return next();

        let nextCalled = false;
        let nextResult: CallbackResult;
        const guardedNext: CallbackFn = () => {
          if (nextCalled) return nextResult;
          nextCalled = true;
          nextResult = next();
          return nextResult;
        };
        const recover = (): CallbackResult => {
          // The customer fn's own error always wins.
          if (fnError) throw fnError.error;
          return guardedNext();
        };

        let out: CallbackResult;
        try {
          out = hookFn.call(plugin, info, guardedNext);
        } catch {
          return recover();
        }
        if (
          out != null &&
          typeof (out as PromiseLike<unknown>).then === "function"
        ) {
          return (out as PromiseLike<unknown>).then(
            (val: unknown) => val,
            recover,
          );
        }
        return out;
      },
      guardedFn as CallbackFn,
    );

    let result: CallbackResult;
    try {
      result = chain();
    } catch (_err) {
      // If the chain threw synchronously, check if it was from the customer fn
      if (fnError) throw fnError.error;
      // Otherwise it's a plugin error that escaped — swallow and call fn directly
      result = (guardedFn as CallbackFn)();
    }

    // If the result is async, ensure fn errors are re-thrown even if swallowed by a plugin
    if (
      result != null &&
      typeof (result as PromiseLike<unknown>).then === "function"
    ) {
      return (result as PromiseLike<unknown>).then((val: CustomerFnResult) => {
        if (fnError) throw fnError.error;
        return val;
      });
    }

    // Sync path: if fn threw but the chain swallowed it, re-throw
    if (fnError) throw fnError.error;
    return result;
  };

  /**
   * Invokes `method` on every plugin and awaits any promises they return.
   * Used for `onInvocationStart` only: it runs before any durable operation,
   * so waiting for it cannot delay an operation, and a plugin can rely on its
   * setup having finished before the first operation hook. Plugin errors —
   * synchronous or asynchronous — are swallowed so a misbehaving plugin never
   * affects SDK execution. Hooks are invoked on all plugins concurrently and
   * the runner waits for all of them to settle.
   */
  const run = async <K extends keyof DurableInstrumentationPlugin>(
    method: K,
    info: Parameters<NonNullable<DurableInstrumentationPlugin[K]>>[0],
  ): Promise<void> => {
    await Promise.allSettled(invokeAll(method, info));
  };

  /**
   * Calls `method` on every plugin, in plugin order, and returns without
   * waiting for the promises the hooks return. Used for every hook that fires
   * while operations run, so a slow plugin cannot delay an operation or the
   * invocation's suspension.
   *
   * The synchronous part of each hook still runs before this returns. A plugin
   * can therefore rely on the order in which its hooks are called, and on state
   * a hook sets synchronously, for example a span that a later `wrap` hook
   * looks up. The asynchronous parts of consecutive hooks may overlap.
   *
   * The returned promises are kept until they settle, and `onInvocationEnd`
   * drains them.
   */
  const fireAndForget = <K extends keyof DurableInstrumentationPlugin>(
    method: K,
    info: Parameters<NonNullable<DurableInstrumentationPlugin[K]>>[0],
  ): Promise<void> => {
    for (const promise of invokeAll(method, info)) {
      pending.add(promise);
      void promise.then(() => pending.delete(promise));
    }
    return Promise.resolve();
  };

  /**
   * Waits for the hook work still pending, then calls `onInvocationEnd` on
   * every plugin and waits for it.
   *
   * Two deadlines bound the waits, so a plugin that never settles cannot hold
   * the invocation to the Lambda timeout:
   * 1. The drain of earlier hook work ends {@link PLUGIN_DRAIN_RESERVE_MS}
   *    before the invocation's deadline.
   * 2. The wait for `onInvocationEnd` ends {@link PLUGIN_END_RESERVE_MS}
   *    before the deadline. That reserve is smaller, because `onInvocationEnd`
   *    is where a plugin flushes. So a slow operation hook cannot take the
   *    flush's time, and an invocation that ends close to its timeout still
   *    flushes.
   *
   * Work that has not settled by its deadline is abandoned. Without a known
   * deadline, both waits last until everything settles.
   */
  const drainAndEnd = async (info: InvocationEndInfo): Promise<void> => {
    const deadline = readRemainingMs(options.getRemainingTimeMs) + Date.now();
    const drainEndBy = deadline - PLUGIN_DRAIN_RESERVE_MS;
    // A hook that settles can start more hook work, so drain until nothing is
    // left or the drain deadline is reached.
    while (pending.size > 0 && Date.now() < drainEndBy) {
      await settleBy([...pending], drainEndBy);
    }
    await settleBy(
      invokeAll("onInvocationEnd", info),
      deadline - PLUGIN_END_RESERVE_MS,
    );
  };

  return {
    providePropagationMetadata: (input) =>
      collectPropagationMetadata(plugins, input),
    onInvocationStart: (info: InvocationInfo): Promise<void> =>
      run("onInvocationStart", info),
    wrapInvocation: (
      info: InvocationInfo,
      fn: () => Promise<DurableExecutionInvocationOutput>,
    ): Promise<DurableExecutionInvocationOutput> =>
      runAsCallback(
        "wrapInvocation",
        info,
        fn,
      ) as Promise<DurableExecutionInvocationOutput>,
    onInvocationEnd: (info: InvocationEndInfo): Promise<void> =>
      drainAndEnd(info),
    onOperationStart: (info: OperationInfo): Promise<void> =>
      fireAndForget("onOperationStart", info),
    wrapChildContextFn: (
      info: OperationInfo,
      fn: CustomerFn,
    ): CustomerFnResult => runAsCallback("wrapChildContextFn", info, fn),
    onOperationEnd: (info: OperationEndInfo): Promise<void> =>
      fireAndForget("onOperationEnd", info),
    onOperationAttemptStart: (info: AttemptInfo): Promise<void> =>
      fireAndForget("onOperationAttemptStart", info),
    wrapOperationAttemptFn: (
      info: AttemptInfo,
      fn: CustomerFn,
    ): CustomerFnResult => runAsCallback("wrapOperationAttemptFn", info, fn),
    onOperationAttemptEnd: (info: AttemptEndInfo): Promise<void> =>
      fireAndForget("onOperationAttemptEnd", info),
    onOperationChange: (info: OperationChangeInfo): Promise<void> =>
      fireAndForget("onOperationChange", info),
    enrichLogContext: () =>
      plugins.reduce(
        (acc, p) => {
          try {
            return { ...acc, ...p.enrichLogContext?.() };
          } catch {
            return acc;
          }
        },
        {} as Record<string, string | number | boolean>,
      ),
  };
}
