import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import { context, trace, propagation, ROOT_CONTEXT } from "@opentelemetry/api";
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

const TEST_ARN =
  "arn:aws:states:us-east-1:123456789012:execution:my-sm:exec-123";
const TEST_REQUEST_ID = "req-abc-123";

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

describe("ExecutionOtelPlugin - Span Link Construction", () => {
  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  describe("buildInvocationLinks() returns link to the plugin-created Invocation_Span in default-provider mode", () => {
    /**
     * When useDefaultTracerProvider=true, the plugin still creates its own
     * Invocation_Span (as a child of the ambient context) and builds span
     * links pointing to that plugin-created span.
     */
    it("Operation_Span has a link to the plugin-created Invocation_Span", async () => {
      const plugin = new ExecutionOtelPlugin({
        tracerProvider: provider,
        useDefaultTracerProvider: true,
      });

      // Create an ambient span simulating the invocation span from environment/layer
      const ambientTracer = provider.getTracer("ambient-test");
      const ambientSpan = ambientTracer.startSpan("ambient-invocation");
      const ambientContext = trace.setSpan(ROOT_CONTEXT, ambientSpan);

      // Run onInvocationStart within the ambient context so it gets captured
      await context.with(ambientContext, async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
      });

      // Create an operation - its links should point to the ambient span
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-link-test", name: "link-op" }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-link-test", name: "link-op" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      ambientSpan.end();

      const opSpan = findSpan(exporter, "link-op");
      const invocationSpan = findSpan(exporter, "invocation");
      expect(opSpan).toBeDefined();
      expect(invocationSpan).toBeDefined();
      expect(opSpan!.links.length).toBeGreaterThan(0);

      // The link should point to the plugin-created Invocation_Span, not the ambient span
      const linkSpanContext = opSpan!.links[0].context;
      expect(linkSpanContext.traceId).toBe(
        invocationSpan!.spanContext().traceId,
      );
      expect(linkSpanContext.spanId).toBe(invocationSpan!.spanContext().spanId);
    });

    it("Attempt_Span has a link to the plugin-created Invocation_Span", async () => {
      const plugin = new ExecutionOtelPlugin({
        tracerProvider: provider,
        useDefaultTracerProvider: true,
      });

      const ambientTracer = provider.getTracer("ambient-test");
      const ambientSpan = ambientTracer.startSpan("ambient-invocation");
      const ambientContext = trace.setSpan(ROOT_CONTEXT, ambientSpan);

      await context.with(ambientContext, async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
      });

      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-attempt-link", name: "attempt-link-step" }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({
          id: "op-attempt-link",
          name: "attempt-link-step",
          attempt: 1,
        }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({ id: "op-attempt-link", attempt: 1 }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "op-attempt-link",
          name: "attempt-link-step",
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      ambientSpan.end();

      const attemptSpan = getExportedSpans(exporter).find(
        (s) => s.attributes["durable.attempt.number"] === 1,
      );
      const invocationSpan = findSpan(exporter, "invocation");
      expect(attemptSpan).toBeDefined();
      expect(invocationSpan).toBeDefined();
      expect(attemptSpan!.links.length).toBeGreaterThan(0);

      const linkSpanContext = attemptSpan!.links[0].context;
      expect(linkSpanContext.traceId).toBe(
        invocationSpan!.spanContext().traceId,
      );
      expect(linkSpanContext.spanId).toBe(invocationSpan!.spanContext().spanId);
    });
  });

  describe("buildInvocationLinks() returns link to explicit Invocation_Span when not in default-provider mode", () => {
    /**
     * When useDefaultTracerProvider is false (default), the plugin creates
     * an explicit Invocation_Span and builds span links pointing to it.
     */
    it("Operation_Span has a link to the explicit Invocation_Span", async () => {
      const plugin = new ExecutionOtelPlugin({
        tracerProvider: provider,
        useDefaultTracerProvider: false,
      });

      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-explicit", name: "explicit-op" }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-explicit", name: "explicit-op" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const opSpan = findSpan(exporter, "explicit-op");
      const invocationSpan = findSpan(exporter, "invocation");
      expect(opSpan).toBeDefined();
      expect(invocationSpan).toBeDefined();
      expect(opSpan!.links.length).toBeGreaterThan(0);

      // Link should point to the Invocation_Span
      const linkSpanContext = opSpan!.links[0].context;
      expect(linkSpanContext.spanId).toBe(invocationSpan!.spanContext().spanId);
      expect(linkSpanContext.traceId).toBe(
        invocationSpan!.spanContext().traceId,
      );
    });

    it("Attempt_Span has a link to the explicit Invocation_Span", async () => {
      const plugin = new ExecutionOtelPlugin({
        tracerProvider: provider,
        useDefaultTracerProvider: false,
      });

      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-att-explicit", name: "att-explicit-op" }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({
          id: "op-att-explicit",
          name: "att-explicit-op",
          attempt: 1,
        }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({ id: "op-att-explicit", attempt: 1 }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "op-att-explicit",
          name: "att-explicit-op",
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const attemptSpan = getExportedSpans(exporter).find(
        (s) => s.attributes["durable.attempt.number"] === 1,
      );
      const invocationSpan = findSpan(exporter, "invocation");
      expect(attemptSpan).toBeDefined();
      expect(invocationSpan).toBeDefined();
      expect(attemptSpan!.links.length).toBeGreaterThan(0);

      const linkSpanContext = attemptSpan!.links[0].context;
      expect(linkSpanContext.spanId).toBe(invocationSpan!.spanContext().spanId);
    });
  });

  describe("buildInvocationLinks() links to Invocation span when no ambient invocation context exists", () => {
    /**
     * When useDefaultTracerProvider is true but no ambient span exists,
     * links should point to the Invocation span we always create.
     */
    it("Operation_Span has link to Invocation span when no ambient invocation span exists", async () => {
      const plugin = new ExecutionOtelPlugin({
        tracerProvider: provider,
        useDefaultTracerProvider: true,
      });

      // Run onInvocationStart WITHOUT any ambient span in the context
      // (ROOT_CONTEXT has no span)
      await context.with(ROOT_CONTEXT, async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
      });

      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-no-link", name: "no-link-op" }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-no-link", name: "no-link-op" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const opSpan = findSpan(exporter, "no-link-op");
      const invocationSpan = findSpan(exporter, "invocation");
      expect(opSpan).toBeDefined();
      expect(invocationSpan).toBeDefined();
      expect(opSpan!.links.length).toBe(1);
      expect(opSpan!.links[0].context.spanId).toBe(
        invocationSpan!.spanContext().spanId,
      );
    });

    it("Attempt_Span has link to Invocation span when no ambient invocation span exists", async () => {
      const plugin = new ExecutionOtelPlugin({
        tracerProvider: provider,
        useDefaultTracerProvider: true,
      });

      await context.with(ROOT_CONTEXT, async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
      });

      await plugin.onOperationStart(
        makeOperationInfo({
          id: "op-no-link-att",
          name: "no-link-att-step",
        }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({
          id: "op-no-link-att",
          name: "no-link-att-step",
          attempt: 1,
        }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({ id: "op-no-link-att", attempt: 1 }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "op-no-link-att",
          name: "no-link-att-step",
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const attemptSpan = getExportedSpans(exporter).find(
        (s) => s.attributes["durable.attempt.number"] === 1,
      );
      const invocationSpan = findSpan(exporter, "invocation");
      expect(attemptSpan).toBeDefined();
      expect(invocationSpan).toBeDefined();
      expect(attemptSpan!.links.length).toBe(1);
      expect(attemptSpan!.links[0].context.spanId).toBe(
        invocationSpan!.spanContext().spanId,
      );
    });
  });

  describe("Tracer instrumentationName", () => {
    /**
     * The tracer should be created with the correct instrumentation name
     * from the provider, defaulting to "aws-durable-execution-sdk-js".
     */
    it("uses default instrumentationName when not specified", async () => {
      const plugin = new ExecutionOtelPlugin({
        tracerProvider: provider,
      });

      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-name-test", name: "name-test" }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-name-test", name: "name-test" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const opSpan = findSpan(exporter, "name-test");
      expect(opSpan).toBeDefined();
      expect(
        (opSpan as any).instrumentationScope?.name ??
          (opSpan as any).instrumentationLibrary?.name,
      ).toBe("aws-durable-execution-sdk-js");
    });

    it("uses custom instrumentationName when specified", async () => {
      const customName = "my-custom-instrumentation";
      const plugin = new ExecutionOtelPlugin({
        tracerProvider: provider,
        instrumentationName: customName,
      });

      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-custom-name", name: "custom-name-test" }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "op-custom-name",
          name: "custom-name-test",
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const opSpan = findSpan(exporter, "custom-name-test");
      expect(opSpan).toBeDefined();
      expect(
        (opSpan as any).instrumentationScope?.name ??
          (opSpan as any).instrumentationLibrary?.name,
      ).toBe(customName);
    });

    it("single tracer instance is used for all span operations", async () => {
      const plugin = new ExecutionOtelPlugin({
        tracerProvider: provider,
      });

      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-tracer-1", name: "tracer-op-1" }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({
          id: "op-tracer-1",
          name: "tracer-op-1",
          attempt: 1,
        }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({ id: "op-tracer-1", attempt: 1 }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-tracer-1", name: "tracer-op-1" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const allSpans = getExportedSpans(exporter);
      // All spans (Workflow, Invocation, Operation, Attempt) should have same instrumentation scope
      const instrumentationNames = new Set(
        allSpans.map(
          (s) =>
            (s as any).instrumentationScope?.name ??
            (s as any).instrumentationLibrary?.name,
        ),
      );
      expect(instrumentationNames.size).toBe(1);
      expect(instrumentationNames.has("aws-durable-execution-sdk-js")).toBe(
        true,
      );
    });
  });
});
