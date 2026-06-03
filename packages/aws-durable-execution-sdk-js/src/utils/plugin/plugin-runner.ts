import {
  DurableInstrumentationPlugin,
  AttemptEndInfo,
  AttemptInfo,
  InvocationEndInfo,
  InvocationInfo,
  OperationChangeInfo,
  OperationEndInfo,
  OperationInfo,
  CustomerFnResult,
  CustomerFn,
} from "../../types/plugin";
import { DurableExecutionInvocationOutput } from "../../types/core";

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
  | undefined;
type PluginWrapperHookFn = (
  info: PluginInfo,
  fn: CustomerFnResult,
) => CallbackResult;
type PluginHookFn = (info: PluginInfo) => CallbackResult;

/**
 * Creates a composite plugin runner that dispatches lifecycle events to all registered plugins.
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function createPluginRunner(
  plugins: DurableInstrumentationPlugin[],
): DurableInstrumentationPlugin {
  if (plugins.length === 0) return {};

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

  const run = <K extends keyof DurableInstrumentationPlugin>(
    method: K,
    info: Parameters<NonNullable<DurableInstrumentationPlugin[K]>>[0],
  ): void =>
    plugins.forEach((p) => {
      try {
        const result = (p[method] as PluginHookFn)?.(info as PluginInfo);
        // Fire-and-forget — never block the SDK on plugin async work
        if (
          result != null &&
          typeof (result as Promise<unknown>).then === "function"
        ) {
          (result as Promise<unknown>).catch(() => {});
        }
      } catch {
        // Sync errors also swallowed
      }
    });

  return {
    onInvocationStart: (info: InvocationInfo) => run("onInvocationStart", info),
    wrapInvocation: (
      info: InvocationInfo,
      fn: () => Promise<DurableExecutionInvocationOutput>,
    ): Promise<DurableExecutionInvocationOutput> =>
      runAsCallback(
        "wrapInvocation",
        info,
        fn,
      ) as Promise<DurableExecutionInvocationOutput>,
    onInvocationEnd: (info: InvocationEndInfo) => run("onInvocationEnd", info),
    onOperationFirstStart: (info: OperationInfo) =>
      run("onOperationFirstStart", info),
    onOperationStart: (info: OperationInfo) => run("onOperationStart", info),
    wrapChildContextFn: (
      info: OperationInfo,
      fn: CustomerFn,
    ): CustomerFnResult => runAsCallback("wrapChildContextFn", info, fn),
    onOperationFirstEnd: (info: OperationEndInfo) =>
      run("onOperationFirstEnd", info),
    onOperationAttemptStart: (info: AttemptInfo) =>
      run("onOperationAttemptStart", info),
    wrapOperationAttemptFn: (
      info: AttemptInfo,
      fn: CustomerFn,
    ): CustomerFnResult => runAsCallback("wrapOperationAttemptFn", info, fn),
    onOperationAttemptEnd: (info: AttemptEndInfo) =>
      run("onOperationAttemptEnd", info),
    onOperationChange: (info: OperationChangeInfo) =>
      run("onOperationChange", info),
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
