import {
  DurableInstrumentationPlugin,
  AttemptEndInfo,
  AttemptInfo,
  ExecutionEndInfo,
  InvocationInfo,
  OperationChangeInfo,
  OperationInfo,
} from "../../types/plugin";

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
        try {
          const hookFn = plugin[method] as any;
          if (hookFn) {
            return hookFn.call(plugin, info, next);
          }
          return next();
        } catch {
          return next();
        }
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

  const runAwait = async <K extends keyof DurableInstrumentationPlugin>(
    method: K,
    info: Parameters<NonNullable<DurableInstrumentationPlugin[K]>>[0],
  ) => {
    for (const p of plugins) {
      try {
        await (p[method] as any)?.(info);
      } catch {
        // Plugin errors must never affect SDK execution
      }
    }
  };

  return {
    onExecutionStart: (info: InvocationInfo) => run("onExecutionStart", info),
    onExecutionEnd: async (info: ExecutionEndInfo) =>
      runAwait("onExecutionEnd", info),
    onInvocationStart: (info: InvocationInfo) => run("onInvocationStart", info),
    wrapInvocation: <T>(info: InvocationInfo, fn: () => T): T =>
      runAsCallback("wrapInvocation", info, fn),
    onInvocationEnd: async (info: InvocationInfo) =>
      runAwait("onInvocationEnd", info),
    onOperationFirstStart: (info: OperationInfo) =>
      run("onOperationFirstStart", info),
    onOperationStart: (info: OperationInfo) => run("onOperationStart", info),
    wrapOperation: <T>(info: OperationInfo, fn: () => T): T =>
      runAsCallback("wrapOperation", info, fn),
    onOperationFirstEnd: (info: OperationInfo & { error?: Error }) =>
      run("onOperationFirstEnd", info),
    onOperationAttemptStart: (info: AttemptInfo) =>
      run("onOperationAttemptStart", info),
    wrapOperationAttempt: <T>(info: AttemptInfo, fn: () => T): T =>
      runAsCallback("wrapOperationAttempt", info, fn),
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
