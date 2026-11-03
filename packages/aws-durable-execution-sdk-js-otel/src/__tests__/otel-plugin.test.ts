import { afterEach, describe, expect, it, vi } from "vitest";
import { trace } from "@opentelemetry/api";
import type { InvocationInfo } from "@aws/durable-execution-sdk-js";
import * as execution from "../execution-plugin";
import * as invocation from "../invocation-plugin";
import {
  OtelPlugin,
  type OtelPluginFactoryOptions,
  durableExecutionPluginProvider,
} from "../index";
import { durableExecutionPluginProvider as executionProvider } from "../execution-plugin-provider";
import { PLUGIN_REGISTRATION } from "../plugin-registration";

vi.mock("@aws/durable-execution-sdk-js", () => {
  throw new Error("OTel public entry point loaded the core SDK at runtime");
});

afterEach(() => vi.restoreAllMocks());

describe("OtelPlugin.factory", () => {
  it.each([undefined, {}, { mode: undefined }, { mode: "execution" }] as const)(
    "defaults to the original execution factory for %j",
    (options) => {
      const create = vi.spyOn(execution, "createExecutionOtelPluginFactory");
      const factory = OtelPlugin.factory(options);
      expect(factory).toBe(create.mock.results[0].value);
      expect(Reflect.get(factory, PLUGIN_REGISTRATION)).toMatchObject({
        name: "ExecutionOtelPlugin",
        exclusiveGroup: "durable-opentelemetry-view",
      });
    },
  );

  it.each(["execution", "invocation"] as const)(
    "forwards every configuration option and preserves %s factory identity",
    (mode) => {
      const create =
        mode === "execution"
          ? vi.spyOn(execution, "createExecutionOtelPluginFactory")
          : vi.spyOn(invocation, "createInvocationOtelPluginFactory");
      const config = {
        tracerProviderFactory: vi.fn(),
        contextExtractor: vi.fn(),
        instrumentationName: "custom-instrumentation",
        workflowSpanName: "custom-workflow",
        enrichLogger: false,
        flushTimeoutMillis: 123,
      };
      const options = { mode, ...config };
      const factory = OtelPlugin.factory(options);
      expect(create).toHaveBeenCalledExactlyOnceWith(config);
      expect(factory).toBe(create.mock.results[0].value);
      expect(Reflect.get(factory, PLUGIN_REGISTRATION).name).toBe(
        mode === "execution" ? "ExecutionOtelPlugin" : "InvocationOtelPlugin",
      );
      expect(config.tracerProviderFactory).not.toHaveBeenCalled();
      expect(config.contextExtractor).not.toHaveBeenCalled();
      expect(options).toEqual({ mode, ...config });
    },
  );

  it.each([null, "", "EXECUTION", "unknown", 0, false, {}])(
    "rejects invalid explicit mode %j",
    (mode) => {
      expect(() =>
        OtelPlugin.factory({ mode } as OtelPluginFactoryOptions),
      ).toThrow('OTel plugin mode must be "execution" or "invocation".');
    },
  );

  it("selects the view once, before callers can mutate their options", () => {
    const options: OtelPluginFactoryOptions = { mode: "invocation" };
    const factory = OtelPlugin.factory(options);
    options.mode = "execution";
    const info: InvocationInfo = {
      executionArn: "arn:execution:unified",
      requestId: "request",
      executionInput: {},
      isFirstInvocation: true,
      operations: {},
      updatedOperations: {},
    };
    expect(factory.createPlugin(info)).toBeInstanceOf(
      invocation.InvocationOtelPlugin,
    );
  });

  it("reuses the existing default provider without resolving a tracer", async () => {
    const getProvider = vi.spyOn(trace, "getTracerProvider");
    vi.resetModules();
    const root = await import("../index");
    expect(getProvider).not.toHaveBeenCalled();
    expect(durableExecutionPluginProvider).toBe(executionProvider);
    expect(
      Reflect.get(root.durableExecutionPluginProvider, PLUGIN_REGISTRATION),
    ).toMatchObject({ name: "ExecutionOtelPlugin" });
  });
});
