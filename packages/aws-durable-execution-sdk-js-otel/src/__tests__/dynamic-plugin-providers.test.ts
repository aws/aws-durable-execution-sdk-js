import type { DurableInstrumentationPluginProvider } from "@aws/durable-execution-sdk-js";
import { durableExecutionPluginProvider as executionProvider } from "../execution-plugin-provider";
import { ExecutionOtelPlugin } from "../execution-plugin";
import { durableExecutionPluginProvider as invocationProvider } from "../invocation-plugin-provider";
import { InvocationOtelPlugin } from "../invocation-plugin";

jest.mock(
  "@aws/durable-execution-sdk-js",
  () => {
    throw new Error("OTel provider entry points loaded the SDK at runtime");
  },
  { virtual: true },
);

function expectProvider(
  provider: DurableInstrumentationPluginProvider,
  pluginType: abstract new (...args: never[]) => object,
): void {
  expect(provider.pluginApiVersion).toBe(1);
  expect(provider.pluginType).toBe(pluginType);
  expect(provider.createPlugin()).toBeInstanceOf(pluginType);
}

describe("dynamic OTel plugin providers", () => {
  it("creates the execution plugin without loading the SDK at runtime", () => {
    expectProvider(executionProvider, ExecutionOtelPlugin);
  });

  it("creates the invocation plugin without loading the SDK at runtime", () => {
    expectProvider(invocationProvider, InvocationOtelPlugin);
  });
});
