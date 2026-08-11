import {
  DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION,
  type DurableInstrumentationPluginProvider,
} from "@aws/durable-execution-sdk-js";
import { durableExecutionPluginProvider as executionProvider } from "../execution-plugin-provider";
import { ExecutionOtelPlugin } from "../execution-plugin";
import { durableExecutionPluginProvider as invocationProvider } from "../invocation-plugin-provider";
import { InvocationOtelPlugin } from "../invocation-plugin";

function expectProvider(
  provider: DurableInstrumentationPluginProvider,
  pluginType: abstract new (...args: never[]) => object,
): void {
  expect(provider.pluginApiVersion).toBe(
    DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION,
  );
  expect(provider.pluginType).toBe(pluginType);
  expect(provider.createPlugin()).toBeInstanceOf(pluginType);
}

describe("dynamic OTel plugin providers", () => {
  it("creates the execution plugin", () => {
    expectProvider(executionProvider, ExecutionOtelPlugin);
  });

  it("creates the invocation plugin", () => {
    expectProvider(invocationProvider, InvocationOtelPlugin);
  });
});
