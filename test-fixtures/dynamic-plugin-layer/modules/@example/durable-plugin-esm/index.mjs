class EsmLayerPlugin {
  async onInvocationStart() {
    globalThis.__dynamicPluginInvocationCount =
      (globalThis.__dynamicPluginInvocationCount ?? 0) + 1;
  }
}

// A provider export must be an object carrying a `createPlugin` method. A bare
// function is rejected when the handler initializes, so the export below is an
// object. The SDK calls `createPlugin` once per invocation to build that
// invocation's plugin instance.
export const durableExecutionPluginProvider = {
  createPlugin: () => new EsmLayerPlugin(),
};
