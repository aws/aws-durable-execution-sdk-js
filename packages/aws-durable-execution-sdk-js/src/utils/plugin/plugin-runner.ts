import {
  DurableInstrumentationPlugin,
  AttemptEndInfo,
  AttemptInfo,
  ExecutionEndInfo,
  InvocationInfo,
  OperationChangeInfo,
  OperationInfo,
} from "../../types/plugin";

/**
 * Creates a composite plugin runner that dispatches lifecycle events to all registered plugins.
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function createPluginRunner(
  plugins: DurableInstrumentationPlugin[],
): DurableInstrumentationPlugin {
  if (plugins.length === 0) return {};

  type CustomerFnResult = any;
  type CallbackResult = any;
  type SimpleCallback = () => CallbackResult;
  type WrapperHookFn = (info: PluginInfo, fn: SimpleCallback) => CallbackResult;
  type PluginInfo =
    | OperationInfo
    | InvocationInfo
    | ExecutionEndInfo
    | AttemptEndInfo
    | AttemptInfo
    | OperationChangeInfo
    | undefined;
  type DataCallback = (info: PluginInfo) => CallbackResult;
  type PluginHookFn = SimpleCallback | DataCallback;

  const runAsCallback = <K extends keyof DurableInstrumentationPlugin>(
    method: K,
    info: Parameters<NonNullable<DurableInstrumentationPlugin[K]>>[0],
    fn: () => CustomerFnResult,
  ) => {
    let fnError: { error: unknown } | undefined;

    // Wrap the original fn to capture any error it throws
    const guardedFn = () => {
      try {
        const result = fn();
        if (result && typeof result.then === "function") {
          return result.catch((err: unknown) => {
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

    const chain = plugins.reduceRight(
      (next, plugin) => () => {
        const hookFn = plugin[method] as WrapperHookFn;
        if (hookFn) {
          return hookFn.call(plugin, info, next);
        }
        return next();
      },
      guardedFn,
    );

    const result = chain();

    // If the result is async, ensure fn errors are re-thrown even if swallowed by a plugin
    if (result && typeof result.then === "function") {
      return result.then((val: CustomerFnResult) => {
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
  ) =>
    plugins.forEach((p) => {
      try {
        const result = (p[method] as PluginHookFn)?.(info as PluginInfo);
        // Fire-and-forget — never block the SDK on plugin async work
        if (result && typeof result.catch === "function") {
          result.catch(() => {});
        }
      } catch {
        // Sync errors also swallowed
      }
    });

  return {
    onExecutionEnd: (info: ExecutionEndInfo) => run("onExecutionEnd", info),
    onInvocationStart: (info: InvocationInfo) => run("onInvocationStart", info),
    wrapInvocation: <T>(info: InvocationInfo, fn: () => T): T =>
      runAsCallback("wrapInvocation", info, fn),
    onInvocationEnd: (info: InvocationInfo) => run("onInvocationEnd", info),
    onOperationFirstStart: (info: OperationInfo) =>
      run("onOperationFirstStart", info),
    onOperationStart: (info: OperationInfo) => run("onOperationStart", info),
    wrapChildContextFn: <T>(info: OperationInfo, fn: () => T): T =>
      runAsCallback("wrapChildContextFn", info, fn),
    onOperationFirstEnd: (info: OperationInfo & { error?: Error }) =>
      run("onOperationFirstEnd", info),
    onOperationAttemptStart: (info: AttemptInfo) =>
      run("onOperationAttemptStart", info),
    wrapOperationAttemptFn: <T>(info: AttemptInfo, fn: () => T): T =>
      runAsCallback("wrapOperationAttemptFn", info, fn),
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
