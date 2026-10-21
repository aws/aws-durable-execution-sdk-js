// The import below fails before the export is ever read: the point of this
// fixture is that the module's own evaluation error reaches the caller with the
// missing peer named, not that the export is well-formed.
import "@example/durable-plugin-peer-that-is-not-installed";

export const durableExecutionPluginProvider = { createPlugin: () => ({}) };
