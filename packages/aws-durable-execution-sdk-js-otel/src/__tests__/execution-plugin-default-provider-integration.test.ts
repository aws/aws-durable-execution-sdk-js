import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import { context, trace, propagation } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";
import type {
  InvocationInfo,
  InvocationEndInfo,
  OperationInfo,
  OperationEndInfo,
  AttemptInfo,
  AttemptEndInfo,
} from "@aws/durable-execution-sdk-js";
import { ExecutionOtelPlugin } from "../execution-plugin";
import { ProviderSource } from "../otel-plugin-config";

const TEST_ARN =
  "arn:aws:states:us-east-1:123456789012:execution:my-sm:exec-integration-1";
const TEST_REQUEST_ID = "req-integration-123";

function makeInvocationInfo(
  overrides?: Partial<InvocationInfo>,
): InvocationInfo {
  return {
    requestId: TEST_REQUEST_ID,
    executionArn: TEST_ARN,
    isFirstInvocation: true,
    executionInput: {},
    operations: {},
    updatedOperations: {},
    ...overrides,
  };
}

function makeInvocationEndInfo(
  overrides?: Partial<InvocationEndInfo>,
): InvocationEndInfo {
  return {
    requestId: TEST_REQUEST_ID,
    executionArn: TEST_ARN,
    executionInput: {},
    operations: {},
    status: "SUCCEEDED" as any,
    executionResult: undefined,
    executionError: undefined,
    ...overrides,
  };
}

function makeOperationInfo(overrides?: Partial<OperationInfo>): OperationInfo {
  return {
    id: "op-1",
    type: "step",
    isReplay: false,
    ...overrides,
  };
}

function makeOperationEndInfo(
  overrides?: Partial<OperationEndInfo>,
): OperationEndInfo {
  return {
    id: "op-1",
    type: "step",
    isReplay: false,
    ...overrides,
  };
}

function makeAttemptInfo(overrides?: Partial<AttemptInfo>): AttemptInfo {
  return {
    id: "op-1",
    type: "step",
    isReplay: false,
    attempt: 1,
    ...overrides,
  };
}

function makeAttemptEndInfo(
  overrides?: Partial<AttemptEndInfo>,
): AttemptEndInfo {
  return {
    id: "op-1",
    type: "step",
    isReplay: false,
    attempt: 1,
    outcome: "SUCCEEDED" as any,
    ...overrides,
  };
}

function getExportedSpans(exporter: InMemorySpanExporter): ReadableSpan[] {
  return exporter.getFinishedSpans();
}

function findSpan(
  exporter: InMemorySpanExporter,
  name: string,
): ReadableSpan | undefined {
  return getExportedSpans(exporter).find((s) => s.name === name);
}

function findSpans(
  exporter: InMemorySpanExporter,
  name: string,
): ReadableSpan[] {
  return getExportedSpans(exporter).filter((s) => s.name === name);
}

/**
 * Integration test: End-to-end span export with default provider.
 *
 * This test registers a real NodeTracerProvider with InMemorySpanExporter globally,
 * creates a ExecutionOtelPlugin with providerSource: ProviderSource.GLOBAL, and simulates
 * a full invocation lifecycle verifying the complete span hierarchy is exported.
 *
 * Since this test runs locally (no Lambda environment), there is no ambient invocation
 * span. Span links will be empty — this is expected behavior in local/test environments.
 */
describe("ExecutionOtelPlugin - Integration: End-to-end span export with default provider (no ambient span)", () => {
  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    // Register globally so trace.getTracerProvider() returns this provider
    provider.register();
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it("exports spans through the globally registered provider pipeline", async () => {
    const plugin = new ExecutionOtelPlugin({
      providerSource: ProviderSource.GLOBAL,
    });

    // Simulate full invocation lifecycle:
    // onInvocationStart → onOperationStart → onOperationAttemptStart →
    // onOperationAttemptEnd → onOperationEnd → onInvocationEnd
    await plugin.onInvocationStart(makeInvocationInfo());

    await plugin.onOperationStart(
      makeOperationInfo({ id: "op-step-1", name: "fetch-data" }),
    );

    await plugin.onOperationAttemptStart(
      makeAttemptInfo({ id: "op-step-1", name: "fetch-data", attempt: 1 }),
    );

    await plugin.onOperationAttemptEnd(
      makeAttemptEndInfo({ id: "op-step-1", attempt: 1 }),
    );

    await plugin.onOperationEnd(
      makeOperationEndInfo({ id: "op-step-1", name: "fetch-data" }),
    );

    await plugin.onInvocationEnd(
      makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
    );

    // Verify spans were exported via InMemorySpanExporter
    const spans = getExportedSpans(exporter);
    expect(spans.length).toBeGreaterThan(0);

    // Verify Workflow_Span exists
    const workflowSpan = findSpan(exporter, "Workflow");
    expect(workflowSpan).toBeDefined();

    // Verify operation span exists
    const opSpan = findSpan(exporter, "fetch-data");
    expect(opSpan).toBeDefined();

    // Verify attempt span exists
    const attemptSpan = spans.find(
      (s) => s.attributes["durable.attempt.number"] === 1,
    );
    expect(attemptSpan).toBeDefined();
  });

  it("Workflow_Span is a root span with no parent", async () => {
    const plugin = new ExecutionOtelPlugin({
      providerSource: ProviderSource.GLOBAL,
    });

    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onOperationStart(
      makeOperationInfo({ id: "op-1", name: "my-step" }),
    );
    await plugin.onOperationEnd(
      makeOperationEndInfo({ id: "op-1", name: "my-step" }),
    );
    await plugin.onInvocationEnd(
      makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
    );

    const workflowSpan = findSpan(exporter, "Workflow");
    expect(workflowSpan).toBeDefined();

    // Workflow_Span MUST be a root span — no parent span context
    expect(workflowSpan!.parentSpanContext).toBeUndefined();
  });

  it("Invocation_Span is created as child of ambient context", async () => {
    const plugin = new ExecutionOtelPlugin({
      providerSource: ProviderSource.GLOBAL,
    });

    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onOperationStart(
      makeOperationInfo({ id: "op-1", name: "my-step" }),
    );
    await plugin.onOperationAttemptStart(
      makeAttemptInfo({ id: "op-1", name: "my-step", attempt: 1 }),
    );
    await plugin.onOperationAttemptEnd(
      makeAttemptEndInfo({ id: "op-1", attempt: 1 }),
    );
    await plugin.onOperationEnd(
      makeOperationEndInfo({ id: "op-1", name: "my-step" }),
    );
    await plugin.onInvocationEnd(
      makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
    );

    const invocationSpans = findSpans(exporter, "Invocation");
    expect(invocationSpans.length).toBe(1);
    expect(invocationSpans[0].attributes["durable.execution.arn"]).toBe(
      TEST_ARN,
    );
    expect(invocationSpans[0].attributes["durable.invocation.first"]).toBe(
      true,
    );
  });

  it("operation and attempt spans have correct parent-child hierarchy under Workflow_Span", async () => {
    const plugin = new ExecutionOtelPlugin({
      providerSource: ProviderSource.GLOBAL,
    });

    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.wrapInvocation(makeInvocationInfo(), async () => {
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-1", name: "process-item" }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({ id: "op-1", name: "process-item", attempt: 1 }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({ id: "op-1", attempt: 1 }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-1", name: "process-item" }),
      );
      return { output: undefined } as any;
    });
    await plugin.onInvocationEnd(
      makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
    );

    const workflowSpan = findSpan(exporter, "Workflow");
    const opSpan = findSpan(exporter, "process-item");
    const attemptSpan = getExportedSpans(exporter).find(
      (s) => s.attributes["durable.attempt.number"] === 1,
    );

    expect(workflowSpan).toBeDefined();
    expect(opSpan).toBeDefined();
    expect(attemptSpan).toBeDefined();

    // Operation span is child of Workflow_Span
    expect(opSpan!.parentSpanContext?.spanId).toBe(
      workflowSpan!.spanContext().spanId,
    );

    // Attempt span is child of Operation span
    expect(attemptSpan!.parentSpanContext?.spanId).toBe(
      opSpan!.spanContext().spanId,
    );
  });

  it("span links point to the Invocation span when there is no ambient invocation span", async () => {
    const plugin = new ExecutionOtelPlugin({
      providerSource: ProviderSource.GLOBAL,
    });

    // No ambient invocation span in local test environment
    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onOperationStart(
      makeOperationInfo({ id: "op-1", name: "my-operation" }),
    );
    await plugin.onOperationAttemptStart(
      makeAttemptInfo({ id: "op-1", name: "my-operation", attempt: 1 }),
    );
    await plugin.onOperationAttemptEnd(
      makeAttemptEndInfo({ id: "op-1", attempt: 1 }),
    );
    await plugin.onOperationEnd(
      makeOperationEndInfo({ id: "op-1", name: "my-operation" }),
    );
    await plugin.onInvocationEnd(
      makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
    );

    const opSpan = findSpan(exporter, "my-operation");
    const attemptSpan = getExportedSpans(exporter).find(
      (s) => s.attributes["durable.attempt.number"] === 1,
    );
    const invocationSpan = findSpan(exporter, "Invocation");

    expect(opSpan).toBeDefined();
    expect(attemptSpan).toBeDefined();
    expect(invocationSpan).toBeDefined();

    // Links point to the Invocation span we created
    expect(opSpan!.links.length).toBe(1);
    expect(opSpan!.links[0].context.spanId).toBe(
      invocationSpan!.spanContext().spanId,
    );
    expect(attemptSpan!.links.length).toBe(1);
    expect(attemptSpan!.links[0].context.spanId).toBe(
      invocationSpan!.spanContext().spanId,
    );
  });

  it("no shutdown is called on the globally registered provider", async () => {
    const shutdownSpy = jest.spyOn(provider, "shutdown");

    const plugin = new ExecutionOtelPlugin({
      providerSource: ProviderSource.GLOBAL,
    });

    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onOperationStart(
      makeOperationInfo({ id: "op-1", name: "my-step" }),
    );
    await plugin.onOperationEnd(
      makeOperationEndInfo({ id: "op-1", name: "my-step" }),
    );
    await plugin.onInvocationEnd(
      makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
    );

    // Shutdown must never be called on a provider the plugin doesn't own
    expect(shutdownSpy).not.toHaveBeenCalled();

    shutdownSpy.mockRestore();
  });

  it("full lifecycle with multiple operations produces correct span hierarchy", async () => {
    const plugin = new ExecutionOtelPlugin({
      providerSource: ProviderSource.GLOBAL,
    });

    // Simulate: start → op1 (with attempt) → op2 (with attempt) → end
    await plugin.onInvocationStart(makeInvocationInfo());

    await plugin.wrapInvocation(makeInvocationInfo(), async () => {
      // Operation 1
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-1", name: "validate-input" }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({ id: "op-1", name: "validate-input", attempt: 1 }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({ id: "op-1", attempt: 1 }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-1", name: "validate-input" }),
      );

      // Operation 2
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-2", name: "process-data" }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({ id: "op-2", name: "process-data", attempt: 1 }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({ id: "op-2", attempt: 1 }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-2", name: "process-data" }),
      );

      return { output: undefined } as any;
    });

    await plugin.onInvocationEnd(
      makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
    );

    const spans = getExportedSpans(exporter);
    const workflowSpan = findSpan(exporter, "Workflow");
    const validateSpan = findSpan(exporter, "validate-input");
    const processSpan = findSpan(exporter, "process-data");

    // All expected spans exist
    expect(workflowSpan).toBeDefined();
    expect(validateSpan).toBeDefined();
    expect(processSpan).toBeDefined();

    // No Invocation_Span — actually now we always create one
    const invocationSpan = findSpan(exporter, "Invocation");
    expect(invocationSpan).toBeDefined();
    expect(invocationSpan!.attributes["durable.execution.arn"]).toBe(TEST_ARN);

    // Workflow is root
    expect(workflowSpan!.parentSpanContext).toBeUndefined();

    // Both operations are children of Workflow_Span
    expect(validateSpan!.parentSpanContext?.spanId).toBe(
      workflowSpan!.spanContext().spanId,
    );
    expect(processSpan!.parentSpanContext?.spanId).toBe(
      workflowSpan!.spanContext().spanId,
    );

    // Attempt spans are children of their respective operations
    const attemptSpans = spans.filter(
      (s) => s.attributes["durable.attempt.number"] === 1,
    );
    expect(attemptSpans.length).toBe(2);

    const validateAttempt = attemptSpans.find((s) =>
      s.name.includes("validate-input"),
    );
    const processAttempt = attemptSpans.find((s) =>
      s.name.includes("process-data"),
    );

    expect(validateAttempt).toBeDefined();
    expect(processAttempt).toBeDefined();
    expect(validateAttempt!.parentSpanContext?.spanId).toBe(
      validateSpan!.spanContext().spanId,
    );
    expect(processAttempt!.parentSpanContext?.spanId).toBe(
      processSpan!.spanContext().spanId,
    );

    // Operation and attempt spans link to the Invocation span (no ambient invocation span locally)
    for (const span of spans) {
      if (span.name !== "Workflow" && span.name !== "Invocation") {
        expect(span.links.length).toBe(1);
        expect(span.links[0].context.spanId).toBe(
          invocationSpan!.spanContext().spanId,
        );
      }
    }

    // Workflow operations form one trace. The parentless Invocation span forms
    // a separate trace instead of becoming a second root in the Workflow trace.
    expect(validateSpan!.spanContext().traceId).toBe(
      workflowSpan!.spanContext().traceId,
    );
    expect(processSpan!.spanContext().traceId).toBe(
      workflowSpan!.spanContext().traceId,
    );
    expect(validateAttempt!.spanContext().traceId).toBe(
      workflowSpan!.spanContext().traceId,
    );
    expect(processAttempt!.spanContext().traceId).toBe(
      workflowSpan!.spanContext().traceId,
    );
    expect(invocationSpan!.spanContext().traceId).not.toBe(
      workflowSpan!.spanContext().traceId,
    );
  });
});
