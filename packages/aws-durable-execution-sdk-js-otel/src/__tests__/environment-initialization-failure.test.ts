/**
 * What happens when the shared environment cannot be built at all.
 *
 * The environment is created lazily, inside the per-invocation factory, so a
 * `tracerProviderFactory` that throws now throws inside an invocation rather
 * than at Lambda initialization. That is the right containment — instrumentation
 * must not decide whether an execution runs — but the attempt must not repeat:
 * the inputs cannot have changed between invocations, and a factory that builds
 * a span processor before throwing would leak one per invocation for the life of
 * the execution environment. These tests pin the latch: one attempt, one log
 * line, and every later invocation refused from the remembered failure. The
 * success path is pinned alongside it, because latching must not turn "resolved
 * once" into "resolved never" or "resolved again".
 */
import { context, propagation, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import type { InvocationInfo } from "@aws/durable-execution-sdk-js";
import { createExecutionOtelPluginFactory } from "../execution-plugin";
import { createInvocationOtelPluginFactory } from "../invocation-plugin";
import type {
  IdGeneratorFactory,
  OtelPluginConfig,
} from "../otel-plugin-config";

const EXECUTION_START = new Date("2024-01-01T00:00:00.000Z");

function invocationInfo(executionArn: string): InvocationInfo {
  return {
    requestId: `request-${executionArn}`,
    executionArn,
    executionStartTimestamp: EXECUTION_START,
    isFirstInvocation: true,
    executionInput: {},
    operations: {},
    updatedOperations: {},
  };
}

const arnFor = (name: string): string =>
  `arn:aws:lambda:us-east-1:123456789012:function:my-func:$LATEST:${name}`;

describe.each([
  ["ExecutionOtelPlugin", createExecutionOtelPluginFactory],
  ["InvocationOtelPlugin", createInvocationOtelPluginFactory],
] as const)("%s environment initialization failure", (_name, createFactory) => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it("calls a throwing tracerProviderFactory once, not once per invocation", () => {
    const tracerProviderFactory = jest.fn(() => {
      throw new Error("provider boom");
    });
    const factory = createFactory({
      tracerProviderFactory,
    } as OtelPluginConfig);

    for (const name of ["a", "b", "c"]) {
      expect(() => factory(invocationInfo(arnFor(name)))).toThrow(
        "provider boom",
      );
    }

    expect(tracerProviderFactory).toHaveBeenCalledTimes(1);
  });

  it("builds at most one of whatever the factory built before it threw", () => {
    // Stands in for the BatchSpanProcessor a real factory constructs before it
    // fails: retrying the attempt leaks one of these per invocation, and nothing
    // ever shuts them down because no provider was returned.
    const built: object[] = [];
    const factory = createFactory({
      tracerProviderFactory: () => {
        built.push(new SimpleSpanProcessor(new InMemorySpanExporter()));
        throw new Error("provider boom");
      },
    });

    for (const name of ["a", "b", "c", "d", "e"]) {
      expect(() => factory(invocationInfo(arnFor(name)))).toThrow(
        "provider boom",
      );
    }

    expect(built).toHaveLength(1);
  });

  it("logs the failure once, not on every invocation", () => {
    const factory = createFactory({
      tracerProviderFactory: () => {
        throw new Error("provider boom");
      },
    });

    for (const name of ["a", "b", "c"]) {
      expect(() => factory(invocationInfo(arnFor(name)))).toThrow();
    }

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0].join(" ")).toContain("provider boom");
    expect(consoleError.mock.calls[0].join(" ")).toContain(
      "aws-durable-execution-sdk-js-otel",
    );
  });

  it("refuses later invocations with the original failure", () => {
    const failure = new Error("provider boom");
    const factory = createFactory({
      tracerProviderFactory: () => {
        throw failure;
      },
    });

    // The same error object every time: the SDK contains it exactly as it
    // contains any factory error, so the invocation runs without this plugin.
    expect(() => factory(invocationInfo(arnFor("a")))).toThrow(failure);
    expect(() => factory(invocationInfo(arnFor("b")))).toThrow(failure);
  });

  it("still resolves a working tracerProviderFactory exactly once", async () => {
    const exporter = new InMemorySpanExporter();
    let tracerProvider: NodeTracerProvider | undefined;
    const tracerProviderFactory = jest.fn(
      (createIdGenerator: IdGeneratorFactory) => {
        tracerProvider ??= new NodeTracerProvider({
          idGenerator: createIdGenerator(),
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        });
        return tracerProvider;
      },
    );
    const factory = createFactory({
      tracerProviderFactory,
    } as OtelPluginConfig);

    for (const name of ["a", "b", "c", "d", "e"]) {
      const info = invocationInfo(arnFor(name));
      const plugin = factory(info);
      await plugin.onInvocationStart?.(info);
    }

    expect(tracerProviderFactory).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();

    await tracerProvider?.shutdown();
  });
});
