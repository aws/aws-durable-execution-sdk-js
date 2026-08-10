import {
  DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION,
  type DurableInstrumentationPluginProvider,
} from "@aws/durable-execution-sdk-js";
import { ExecutionOtelPlugin } from "./execution-plugin";

export const durableExecutionPluginProvider = {
  pluginApiVersion: DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION,
  pluginType: ExecutionOtelPlugin,
  createPlugin: () => new ExecutionOtelPlugin(),
} satisfies DurableInstrumentationPluginProvider<ExecutionOtelPlugin>;
