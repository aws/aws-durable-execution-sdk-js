import type {
  DurableInstrumentationPluginFactory,
  InvocationInfo,
} from "@aws/durable-execution-sdk-js";
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

function invocationInfo(): InvocationInfo {
  return {
    requestId: "request-1",
    executionArn:
      "arn:aws:lambda:us-east-1:123456789012:function:my-func:$LATEST:exec-1",
    executionStartTimestamp: new Date("2024-01-01T00:00:00.000Z"),
    isFirstInvocation: true,
    executionInput: {},
    operations: {},
    updatedOperations: {},
  };
}

function expectProvider(
  provider: DurableInstrumentationPluginFactory,
  pluginType: abstract new (...args: never[]) => object,
): void {
  // The whole provider contract: an object whose createPlugin the SDK calls once
  // per invocation, which returns the plugin for that invocation.
  expect(typeof provider.createPlugin).toBe("function");
  expect(provider.createPlugin(invocationInfo())).toBeInstanceOf(pluginType);
}

describe("dynamic OTel plugin providers", () => {
  it("creates the execution plugin without loading the SDK at runtime", () => {
    expectProvider(executionProvider, ExecutionOtelPlugin);
  });

  it("creates the invocation plugin without loading the SDK at runtime", () => {
    expectProvider(invocationProvider, InvocationOtelPlugin);
  });
});
