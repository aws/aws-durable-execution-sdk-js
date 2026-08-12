import {
  DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION,
  type DurableInstrumentationPluginProvider,
} from "@aws/durable-execution-sdk-js";
import { InvocationOtelPlugin } from "./invocation-plugin";

export const durableExecutionPluginProvider = {
  pluginApiVersion: DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION,
  pluginType: InvocationOtelPlugin,
  createPlugin: () => new InvocationOtelPlugin(),
} satisfies DurableInstrumentationPluginProvider<InvocationOtelPlugin>;
