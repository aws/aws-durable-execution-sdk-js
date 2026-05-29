import {
  DurableInstrumentationPlugin,
  AttemptEndInfo,
  AttemptInfo,
  ExecutionEndInfo,
  InvocationInfo,
  OperationChangeInfo,
  OperationEndInfo,
  OperationInfo,
  CustomerFnResult,
  CustomerFn,
} from "../../types/plugin";

type CallbackResult = unknown;
type CallbackFn = () => CallbackResult;
type PluginInfo =
  | OperationInfo
  | OperationEndInfo
  | InvocationInfo
  | ExecutionEndInfo
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

    // Wrap the original fn to capture any error it throws
    const guardedFn: CallbackResult | CustomerFnResult = () => {
      try {
        const result: CustomerFnResult = fn();
        if (
          result != null &&
          typeof (result as Promise<unknown>).then === "function"
        ) {
          return (result as Promise<unknown>).catch((err: unknown) => {
            fnError = { error: err };
            throw err; // re-throw so plugins still see it
          });
        }
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
          return hookFn.call(plugin, info, next);
        }
        return next();
      },
      guardedFn as CallbackFn,
    );

    const result: CallbackResult = chain();

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
    onExecutionEnd: (info: ExecutionEndInfo) => run("onExecutionEnd", info),
    onInvocationStart: (info: InvocationInfo) => run("onInvocationStart", info),
    wrapInvocation: (info: InvocationInfo, fn: CustomerFn): CustomerFnResult =>
      runAsCallback("wrapInvocation", info, fn),
    onInvocationEnd: (info: InvocationInfo) => run("onInvocationEnd", info),
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
