import type {
  DurableInstrumentationPlugin,
  PropagationInput,
  PropagationMetadata,
} from "../../types/plugin";

function pluginIdentity(
  plugin: DurableInstrumentationPlugin,
  index: number,
): string {
  try {
    return `${plugin.constructor.name || "Plugin"} (plugins[${index}])`;
  } catch {
    return `plugins[${index}]`;
  }
}

function warn(message: string, details: Record<string, string | number>): void {
  try {
    console.warn(message, details);
  } catch {
    // A diagnostic failure must not change the invocation outcome.
  }
}

/** Collects synchronous SDK-owned metadata without altering an invoke request. */
export function collectPropagationMetadata(
  plugins: readonly DurableInstrumentationPlugin[],
  input: PropagationInput,
): PropagationMetadata {
  const snapshot: PropagationInput = Object.freeze({
    executionArn: input.executionArn,
    operationId: input.operationId,
    ...(input.parentOperationId === undefined
      ? {}
      : { parentOperationId: input.parentOperationId }),
    targetFunctionName: input.targetFunctionName,
  });
  let xAmznTraceId: string | undefined;
  let firstPlugin: string | undefined;
  let conflictCount = 0;
  for (const [index, plugin] of plugins.entries()) {
    const identity = pluginIdentity(plugin, index);
    try {
      const hook = plugin.providePropagationMetadata;
      if (hook == null) continue;
      if (typeof hook !== "function")
        throw new TypeError("Propagation hook must be callable");
      const result: unknown = hook.call(plugin, snapshot);
      if (result == null) continue;
      if (typeof result !== "object" || Array.isArray(result)) {
        throw new TypeError("Propagation metadata must be an object");
      }
      if (typeof (result as { then?: unknown }).then === "function") {
        // Misconfigured async hooks are ignored, including their rejections.
        void Promise.resolve(result).catch(() => {});
        throw new TypeError("Propagation hook must be synchronous");
      }
      const value = (result as { xAmznTraceId?: unknown }).xAmznTraceId;
      if (value == null) continue;
      if (typeof value !== "string")
        throw new TypeError("xAmznTraceId must be a string");
      if (xAmznTraceId === undefined) {
        xAmznTraceId = value;
        firstPlugin = identity;
      } else if (value !== xAmznTraceId) {
        warn("Conflicting propagation metadata; keeping the first value.", {
          field: "xAmznTraceId",
          firstPlugin: firstPlugin!,
          laterPlugin: identity,
          conflictCount: ++conflictCount,
        });
      }
    } catch {
      warn("Ignoring invalid propagation metadata from plugin.", {
        plugin: identity,
      });
    }
  }
  return Object.freeze(xAmznTraceId === undefined ? {} : { xAmznTraceId });
}
