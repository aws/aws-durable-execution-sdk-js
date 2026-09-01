import type { DurableInstrumentationPluginProvider } from "@aws/durable-execution-sdk-js";
import { ExecutionOtelPlugin } from "./execution-plugin";

export const durableExecutionPluginProvider = {
  pluginApiVersion: 1,
  pluginType: ExecutionOtelPlugin,
  createPlugin: () => new ExecutionOtelPlugin(),
} satisfies DurableInstrumentationPluginProvider<ExecutionOtelPlugin>;
