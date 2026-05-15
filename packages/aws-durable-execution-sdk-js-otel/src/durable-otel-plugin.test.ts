import { DurableOtelPlugin } from "./durable-otel-plugin";
import type {
  InvocationInfo,
  OperationInfo,
  AttemptInfo,
  AttemptEndInfo,
} from "@aws/durable-execution-sdk-js";
import { AttemptEndInfoOutcome } from "@aws/durable-execution-sdk-js";

describe("DurableOtelPlugin", () => {
  const invocationInfo: InvocationInfo = {
    requestId: "req-123",
    executionArn:
      "arn:aws:lambda:us-east-1:123456789012:function:my-fn:1:exec-abc",
  };

  const operationInfo: OperationInfo = {
    Id: "step-1",
    Name: "fetch-data",
    Type: "STEP",
    SubType: "STEP",
    StartTimestamp: new Date(),
  };

  it("should construct with default config", () => {
    const plugin = new DurableOtelPlugin();
    expect(plugin).toBeDefined();
  });

  it("should implement all DurableInstrumentationPlugin methods", () => {
    const plugin = new DurableOtelPlugin();
    expect(typeof plugin.onExecutionStart).toBe("function");
    expect(typeof plugin.onExecutionEnd).toBe("function");
    expect(typeof plugin.onInvocationStart).toBe("function");
    expect(typeof plugin.onInvocationEnd).toBe("function");
    expect(typeof plugin.onOperationFirstEnd).toBe("function");
    expect(typeof plugin.onOperationAttemptStart).toBe("function");
    expect(typeof plugin.onOperationAttemptEnd).toBe("function");
    expect(typeof plugin.enrichLogContext).toBe("function");
  });

  it("should not throw when sampled out", () => {
    const plugin = new DurableOtelPlugin({ samplingRate: 0.0 });
    plugin.onExecutionStart(invocationInfo);
    plugin.onInvocationStart(invocationInfo);
    plugin.onOperationFirstEnd(operationInfo);
  });

  it("should not throw during full lifecycle when sampled in", () => {
    const plugin = new DurableOtelPlugin({ samplingRate: 1.0 });
    plugin.onExecutionStart(invocationInfo);
    plugin.onInvocationStart(invocationInfo);

    const attemptInfo: AttemptInfo = { ...operationInfo, Attempt: 1 };
    plugin.onOperationAttemptStart(attemptInfo);

    const attemptEndInfo: AttemptEndInfo = {
      ...attemptInfo,
      outcome: AttemptEndInfoOutcome.SUCCEEDED,
    };
    plugin.onOperationAttemptEnd(attemptEndInfo);
    plugin.onOperationFirstEnd(operationInfo);
  });

  it("enrichLogContext returns undefined when no active span", () => {
    const plugin = new DurableOtelPlugin();
    expect(plugin.enrichLogContext()).toBeUndefined();
  });
});
