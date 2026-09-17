class CjsLayerPlugin {
  async onInvocationStart() {
    globalThis.__dynamicPluginInvocationCount =
      (globalThis.__dynamicPluginInvocationCount ?? 0) + 1;
  }
}

// A provider module exports the factory itself: the SDK calls it once per
// invocation to build that invocation's plugin instance.
module.exports = {
  durableExecutionPluginProvider: () => new CjsLayerPlugin(),
};
