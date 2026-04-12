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

  const run = <K extends keyof DurableInstrumentationPlugin>(
    method: K,
    info: Parameters<NonNullable<DurableInstrumentationPlugin[K]>>[0],
  ) =>
    plugins.forEach((p) => {
      try {
        (p[method] as any)?.(info);
      } catch (e) {
        // Plugin errors must never affect SDK execution
      }
    });

  return {
    onExecutionStart: (info: InvocationInfo) => run("onExecutionStart", info),
    onExecutionEnd: (info: ExecutionEndInfo) => run("onExecutionEnd", info),
    onInvocationStart: (info: InvocationInfo) => run("onInvocationStart", info),
    onInvocationEnd: (info: InvocationInfo) => run("onInvocationEnd", info),
    onOperationStart: (info: OperationInfo) => run("onOperationStart", info),
    onOperationEnd: (info: OperationInfo & { error?: Error }) =>
      run("onOperationEnd", info),
    onOperationAttemptStart: (info: AttemptInfo) =>
      run("onOperationAttemptStart", info),
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
