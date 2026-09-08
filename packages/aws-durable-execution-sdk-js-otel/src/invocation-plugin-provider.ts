import type { DurableInstrumentationPluginProvider } from "@aws/durable-execution-sdk-js";
import { InvocationOtelPlugin } from "./invocation-plugin";

export const durableExecutionPluginProvider = {
  pluginApiVersion: 1,
  pluginType: InvocationOtelPlugin,
  createPlugin: () => new InvocationOtelPlugin(),
} satisfies DurableInstrumentationPluginProvider<InvocationOtelPlugin>;
