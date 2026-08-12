class CjsLayerPlugin {
  async onInvocationStart() {
    globalThis.__dynamicPluginInvocationCount =
      (globalThis.__dynamicPluginInvocationCount ?? 0) + 1;
  }
}

module.exports = {
  durableExecutionPluginProvider: {
    pluginApiVersion: 1,
    pluginType: CjsLayerPlugin,
    createPlugin: () => new CjsLayerPlugin(),
  },
};
