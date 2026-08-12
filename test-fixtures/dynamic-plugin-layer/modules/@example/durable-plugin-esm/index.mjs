class EsmLayerPlugin {
  async onInvocationStart() {
    globalThis.__dynamicPluginInvocationCount =
      (globalThis.__dynamicPluginInvocationCount ?? 0) + 1;
  }
}

export const durableExecutionPluginProvider = {
  pluginApiVersion: 1,
  pluginType: EsmLayerPlugin,
  createPlugin: () => new EsmLayerPlugin(),
};
