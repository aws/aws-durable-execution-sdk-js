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

  const runAsCallback = <K extends keyof DurableInstrumentationPlugin>(
    method: K,
    info: Parameters<NonNullable<DurableInstrumentationPlugin[K]>>[0],
    fn: () => any,
  ) => {
    const chain = plugins.reduceRight(
      (next, plugin) => () => {
        const hookFn = plugin[method] as any;
        if (hookFn) {
          return hookFn.call(plugin, info, next);
        }
        return next();
        // we don't catch errors for customer fn execution so that they can propagate to the handler as before
      },
      fn,
    );

    return chain();
  };

  const run = <K extends keyof DurableInstrumentationPlugin>(
    method: K,
    info: Parameters<NonNullable<DurableInstrumentationPlugin[K]>>[0],
  ) =>
    plugins.forEach((p) => {
      try {
        const result = (p[method] as any)?.(info);
        // Fire-and-forget — never block the SDK on plugin async work
        if (result && typeof result.catch === "function") {
          result.catch(() => {});
        }
      } catch {
        // Sync errors also swallowed
      }
    });

  return {
    onExecutionStart: (info: InvocationInfo) => run("onExecutionStart", info),
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
