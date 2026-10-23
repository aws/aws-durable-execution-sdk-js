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
 * Time kept free at the end of an invocation when the plugin drain runs, so
 * the SDK can still return the Lambda response after the drain gives up.
 */
export const PLUGIN_DRAIN_RESERVE_MS = 500;

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
 * Waits for `promises` to settle, but not past the epoch time `endBy`.
 * The promises must not reject.
 */
async function settleBy(
  promises: Promise<void>[],
  endBy: number,
): Promise<void> {
  if (promises.length === 0) return;
  const all = Promise.all(promises).then(() => undefined);
  if (endBy === Infinity) {
    await all;
    return;
  }
  const budgetMs = endBy - Date.now();
  if (budgetMs <= 0) return;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, budgetMs);
  });
  try {
    await Promise.race([all, timeout]);
  } finally {
    clearTimeout(timer);
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

    const chain: CallbackFn = plugins.reduceRight<CallbackFn>(
      (next, plugin) => () => {
        const hookFn = plugin[method] as PluginWrapperHookFn;
        if (hookFn) {
          try {
            return hookFn.call(plugin, info, next);
          } catch {
            // Plugin errors are swallowed — fall through to the inner fn
            return next();
          }
        }
        return next();
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
   * every plugin and waits for it, all within one time budget. The budget is
   * the invocation's remaining time minus {@link PLUGIN_DRAIN_RESERVE_MS}, so a
   * plugin that never settles cannot hold the invocation to the Lambda timeout.
   * Work that has not settled when the budget runs out is abandoned. Without a
   * known deadline, the drain waits for everything.
   */
  const drainAndEnd = async (info: InvocationEndInfo): Promise<void> => {
    const endBy =
      (options.getRemainingTimeMs?.() ?? Infinity) -
      PLUGIN_DRAIN_RESERVE_MS +
      Date.now();
    // A hook that settles can start more hook work, so drain until nothing is
    // left or the budget is spent.
    while (pending.size > 0 && Date.now() < endBy) {
      await settleBy([...pending], endBy);
    }
    await settleBy(invokeAll("onInvocationEnd", info), endBy);
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
