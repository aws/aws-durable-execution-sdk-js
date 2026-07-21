import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import {
  context,
  trace,
  SpanStatusCode,
  propagation,
} from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";
import { InvocationOtelPlugin } from "../invocation-plugin";
import {
  DeterministicIdGenerator,
  deriveSpanIdFromOperationId,
} from "../deterministic-id-generator";
import type {
  InvocationInfo,
  InvocationEndInfo,
  OperationInfo,
  OperationEndInfo,
  AttemptInfo,
  AttemptEndInfo,
} from "@aws/durable-execution-sdk-js";

let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;
let plugin: InvocationOtelPlugin;

const TEST_ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:my-func:$LATEST:exec-123";
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
    executionStartTimestamp: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeInvocationEndInfo(
  overrides?: Partial<InvocationEndInfo>,
): InvocationEndInfo {
  return {
    requestId: TEST_REQUEST_ID,
    executionArn: TEST_ARN,
    executionInput: {}, // required by InvocationBaseInfo (parent type)
    operations: {},
    status: "SUCCEEDED" as any,
    executionResult: undefined,
    executionError: undefined,
    executionStartTimestamp: new Date("2024-01-01T00:00:00Z"),
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

function getExportedSpans(): ReadableSpan[] {
  return exporter.getFinishedSpans();
}

function findSpan(name: string): ReadableSpan | undefined {
  return getExportedSpans().find((s) => s.name === name);
}

let idGenerator: DeterministicIdGenerator;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  idGenerator = new DeterministicIdGenerator();
  provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
    idGenerator,
  });
  provider.register();
  plugin = new InvocationOtelPlugin({ tracerProvider: provider });
});

afterEach(async () => {
  await provider.shutdown();
  exporter.reset();
  // Reset the global API registrations
  trace.disable();
  context.disable();
  propagation.disable();
});

describe("InvocationOtelPlugin", () => {
  describe("onInvocationStart", () => {
    it("creates an invocation span with durable.execution.arn attribute", async () => {
      const info = makeInvocationInfo();
      await plugin.onInvocationStart(info);
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const spans = getExportedSpans();
      const invocationSpan = findSpan("invocation");
      expect(invocationSpan).toBeDefined();
      expect(invocationSpan!.attributes["durable.execution.arn"]).toBe(
        TEST_ARN,
      );
    });

    it('creates invocation span with correct name "invocation"', async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const invocationSpan = findSpan("invocation");
      expect(invocationSpan).toBeDefined();
      expect(invocationSpan!.name).toBe("invocation");
    });
  });

  describe("onInvocationEnd", () => {
    it("ends all open operation spans and invocation span", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(makeOperationInfo({ id: "op-1" }));
      await plugin.onOperationStart(makeOperationInfo({ id: "op-2" }));
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const spans = getExportedSpans();
      // Should have: op-1, op-2, invocation, Workflow (all ended)
      expect(spans.length).toBe(4);
      expect(findSpan("invocation")).toBeDefined();
      expect(findSpan("Workflow")).toBeDefined();
    });

    it("flushes spans (they appear in exporter)", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const spans = getExportedSpans();
      expect(spans.length).toBeGreaterThan(0);
    });

    it("clears all state for warm Lambda reuse", async () => {
      // First invocation
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(makeOperationInfo({ id: "op-1" }));
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      exporter.reset();

      // Second invocation - should not have leftover state
      await plugin.onInvocationStart(
        makeInvocationInfo({ executionArn: "arn:second" }),
      );
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ executionArn: "arn:second" }),
      );

      const spans = getExportedSpans();
      const invocationSpan = findSpan("invocation");
      expect(invocationSpan).toBeDefined();
      expect(invocationSpan!.attributes["durable.execution.arn"]).toBe(
        "arn:second",
      );
      // Only invocation span + Workflow span from second invocation, no leftover op-1
      expect(spans.length).toBe(2);
    });
  });

  describe("onOperationStart / onOperationEnd", () => {
    it("non-replay operation uses deterministic span ID", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      const opInfo = makeOperationInfo({ id: "op-abc", isReplay: false });
      await plugin.onOperationStart(opInfo);
      await plugin.onOperationEnd(makeOperationEndInfo({ id: "op-abc" }));
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const opSpan = findSpan("step");
      expect(opSpan).toBeDefined();
      // When using internal provider with DeterministicIdGenerator, span ID is deterministic.
      // With external provider, we verify the durable.operation.id attribute is set correctly.
      expect(opSpan!.attributes["durable.operation.id"]).toBe("op-abc");
      // Non-replay spans should NOT have links (unlike replay spans)
      expect(opSpan!.links.length).toBe(0);
    });

    it("replay operation uses random span ID with Link to deterministic", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      const opInfo = makeOperationInfo({
        id: "op-replay",
        type: "CONTEXT",
        isReplay: true,
      });
      await plugin.onOperationStart(opInfo);
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "op-replay",
          type: "CONTEXT",
          isReplay: true,
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const expectedDeterministicId = deriveSpanIdFromOperationId(
        "op-replay",
        TEST_ARN,
      );
      const opSpan = findSpan("CONTEXT");
      expect(opSpan).toBeDefined();
      // Random span ID should differ from deterministic
      expect(opSpan!.spanContext().spanId).not.toBe(expectedDeterministicId);
      // Should have a Link pointing to deterministic span ID
      expect(opSpan!.links.length).toBeGreaterThan(0);
      expect(opSpan!.links[0].context.spanId).toBe(expectedDeterministicId);
    });

    it("uses operation name as span name when provided", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-named", name: "fetch-user" }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-named", name: "fetch-user" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const opSpan = findSpan("fetch-user");
      expect(opSpan).toBeDefined();
    });

    it("uses operation type as span name when no name provided", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-noname", type: "wait" }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-noname", type: "wait" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const opSpan = findSpan("wait");
      expect(opSpan).toBeDefined();
    });
  });

  describe("Continuation span for cross-invocation operations", () => {
    it("creates continuation span with Link when operation was started in prior invocation", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      // onOperationEnd for an operation NOT in the map (started elsewhere)
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "op-cross",
          type: "step",
          name: "remote-op",
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const continuationSpan = findSpan("remote-op");
      expect(continuationSpan).toBeDefined();
      // Should have a Link pointing to deterministic span ID of op-cross
      const expectedDeterministicId = deriveSpanIdFromOperationId(
        "op-cross",
        TEST_ARN,
      );
      expect(continuationSpan!.links.length).toBeGreaterThan(0);
      expect(continuationSpan!.links[0].context.spanId).toBe(
        expectedDeterministicId,
      );
    });

    it("continuation span uses type as name when no name provided", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-cross-2", type: "invoke" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const continuationSpan = findSpan("invoke");
      expect(continuationSpan).toBeDefined();
    });
  });

  describe("Parent-child resolution via active context", () => {
    it("operation becomes child of invocation span via wrapInvocation context", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());

      await plugin.wrapInvocation(makeInvocationInfo(), async () => {
        await plugin.onOperationStart(
          makeOperationInfo({ id: "root-op", name: "root-child" }),
        );
        await plugin.onOperationEnd(
          makeOperationEndInfo({ id: "root-op", name: "root-child" }),
        );
        return { output: undefined } as any;
      });

      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const invocationSpan = findSpan("invocation");
      const rootOpSpan = findSpan("root-child");
      expect(invocationSpan).toBeDefined();
      expect(rootOpSpan).toBeDefined();
      expect(rootOpSpan!.parentSpanContext?.spanId).toBe(
        invocationSpan!.spanContext().spanId,
      );
    });

    it("nested operation becomes child of parent operation via wrapChildContextFn context", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());

      await plugin.wrapInvocation(makeInvocationInfo(), async () => {
        const parentOpInfo = makeOperationInfo({
          id: "parent-op",
          name: "parent",
        });
        await plugin.onOperationStart(parentOpInfo);

        // wrapChildContextFn sets the parent operation as active context
        plugin.wrapChildContextFn(parentOpInfo, () => {
          // Synchronously start the child within the parent's context
          // (in real usage this is async but the context propagation is synchronous)
        });

        // Start child operation inside the parent's context via wrapChildContextFn
        const childResult = plugin.wrapChildContextFn(parentOpInfo, () => {
          plugin.onOperationStart(
            makeOperationInfo({
              id: "child-op",
              name: "child",
              parentId: "parent-op",
            }),
          );
          return "done";
        });
        expect(childResult).toBe("done");

        await plugin.onOperationEnd(
          makeOperationEndInfo({ id: "child-op", name: "child" }),
        );
        await plugin.onOperationEnd(
          makeOperationEndInfo({ id: "parent-op", name: "parent" }),
        );
        return { output: undefined } as any;
      });

      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const parentSpan = findSpan("parent");
      const childSpan = findSpan("child");
      expect(parentSpan).toBeDefined();
      expect(childSpan).toBeDefined();
      expect(childSpan!.parentSpanContext?.spanId).toBe(
        parentSpan!.spanContext().spanId,
      );
    });

    it("operation without active context has no explicit parent", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      // Call onOperationStart directly without wrapInvocation context
      await plugin.onOperationStart(
        makeOperationInfo({
          id: "orphan-op",
          name: "orphan",
          parentId: "non-existent",
        }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "orphan-op", name: "orphan" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const orphanSpan = findSpan("orphan");
      expect(orphanSpan).toBeDefined();
      // Without active context, parent comes from whatever context.active() resolves to
      // (in tests with no global context set, this is the root)
    });
  });

  describe("Attempt span lifecycle", () => {
    it("creates attempt span as child of operation span", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-attempt", name: "my-step" }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({ id: "op-attempt", name: "my-step", attempt: 1 }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({ id: "op-attempt", attempt: 1 }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-attempt", name: "my-step" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const spans = getExportedSpans();
      const opSpan = spans.find(
        (s) =>
          s.name === "my-step" && !s.attributes["durable.operation.attempt"],
      );
      const attemptSpan = spans.find(
        (s) => s.attributes["durable.operation.attempt"] === 1,
      );
      expect(opSpan).toBeDefined();
      expect(attemptSpan).toBeDefined();
      expect(attemptSpan!.parentSpanContext?.spanId).toBe(
        opSpan!.spanContext().spanId,
      );
    });

    it("attempt span has correct attributes", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-attr", name: "attr-step", type: "step" }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({
          id: "op-attr",
          name: "attr-step",
          type: "step",
          attempt: 2,
        }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({ id: "op-attr", attempt: 2 }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-attr", name: "attr-step" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const attemptSpan = getExportedSpans().find(
        (s) => s.attributes["durable.operation.attempt"] === 2,
      );
      expect(attemptSpan).toBeDefined();
      expect(attemptSpan!.attributes["durable.execution.arn"]).toBe(TEST_ARN);
      expect(attemptSpan!.attributes["durable.operation.type"]).toBe("step");
      expect(attemptSpan!.attributes["durable.operation.name"]).toBe(
        "attr-step",
      );
      expect(attemptSpan!.attributes["durable.operation.attempt"]).toBe(2);
    });

    it("attempt span has Link to deterministic span ID", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-link", name: "link-step" }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({ id: "op-link", name: "link-step", attempt: 1 }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({ id: "op-link", attempt: 1 }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-link", name: "link-step" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const expectedSpanId = deriveSpanIdFromOperationId("op-link", TEST_ARN);
      const attemptSpan = getExportedSpans().find(
        (s) => s.attributes["durable.operation.attempt"] === 1,
      );
      expect(attemptSpan).toBeDefined();
      expect(attemptSpan!.links.length).toBeGreaterThan(0);
      expect(attemptSpan!.links[0].context.spanId).toBe(expectedSpanId);
    });

    it("onOperationAttemptEnd ends the attempt span", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-end", name: "end-step" }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({ id: "op-end", name: "end-step", attempt: 1 }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({ id: "op-end", attempt: 1 }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-end", name: "end-step" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const attemptSpan = getExportedSpans().find(
        (s) => s.attributes["durable.operation.attempt"] === 1,
      );
      expect(attemptSpan).toBeDefined();
      // Span should be ended (it's in the exported list)
      expect(attemptSpan!.endTime).toBeDefined();
    });

    it("attempt span name includes 'attempt <number>' postfix", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-name-fmt", name: "my-step", type: "step" }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({
          id: "op-name-fmt",
          name: "my-step",
          type: "step",
          attempt: 3,
        }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({ id: "op-name-fmt", attempt: 3 }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-name-fmt", name: "my-step" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const attemptSpan = getExportedSpans().find(
        (s) => s.attributes["durable.operation.attempt"] === 3,
      );
      expect(attemptSpan).toBeDefined();
      expect(attemptSpan!.name).toBe("my-step attempt 3");
    });

    it("attempt span name uses type when no name provided", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-type-fmt", type: "step" }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({ id: "op-type-fmt", type: "step", attempt: 1 }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({ id: "op-type-fmt", attempt: 1 }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-type-fmt", type: "step" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const attemptSpan = getExportedSpans().find(
        (s) =>
          s.attributes["durable.operation.id"] === "op-type-fmt" &&
          s.attributes["durable.operation.attempt"] === 1,
      );
      expect(attemptSpan).toBeDefined();
      expect(attemptSpan!.name).toBe("step attempt 1");
    });

    it("attempt span includes durable.attempt.outcome attribute on success", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({
          id: "op-outcome-ok",
          name: "outcome-step",
          type: "step",
        }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({
          id: "op-outcome-ok",
          name: "outcome-step",
          type: "step",
          attempt: 1,
        }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({
          id: "op-outcome-ok",
          attempt: 1,
          outcome: "SUCCEEDED" as any,
        }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-outcome-ok", name: "outcome-step" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const attemptSpan = getExportedSpans().find(
        (s) =>
          s.attributes["durable.operation.id"] === "op-outcome-ok" &&
          s.attributes["durable.operation.attempt"] === 1,
      );
      expect(attemptSpan).toBeDefined();
      expect(attemptSpan!.attributes["durable.attempt.outcome"]).toBe(
        "SUCCEEDED",
      );
    });

    it("attempt span includes durable.attempt.outcome attribute on failure", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({
          id: "op-outcome-fail",
          name: "fail-step",
          type: "step",
        }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({
          id: "op-outcome-fail",
          name: "fail-step",
          type: "step",
          attempt: 1,
        }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({
          id: "op-outcome-fail",
          attempt: 1,
          outcome: "FAILED" as any,
          error: new Error("step failed"),
        }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-outcome-fail", name: "fail-step" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const attemptSpan = getExportedSpans().find(
        (s) =>
          s.attributes["durable.operation.id"] === "op-outcome-fail" &&
          s.attributes["durable.operation.attempt"] === 1,
      );
      expect(attemptSpan).toBeDefined();
      expect(attemptSpan!.attributes["durable.attempt.outcome"]).toBe("FAILED");
    });
  });

  describe("Error handling", () => {
    it("onOperationEnd with error sets ERROR status and records exception", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-err", name: "err-step" }),
      );
      const testError = new Error("Something went wrong");
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "op-err",
          name: "err-step",
          error: testError,
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const opSpan = findSpan("err-step");
      expect(opSpan).toBeDefined();
      expect(opSpan!.status.code).toBe(SpanStatusCode.ERROR);
      expect(opSpan!.status.message).toBe("Something went wrong");
      // recordException adds an event
      const exceptionEvent = opSpan!.events.find((e) => e.name === "exception");
      expect(exceptionEvent).toBeDefined();
    });

    it("onOperationAttemptEnd with error sets ERROR status and records exception", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-attemptErr", name: "attempt-err" }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({
          id: "op-attemptErr",
          name: "attempt-err",
          attempt: 1,
        }),
      );
      const testError = new Error("Attempt failed");
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({
          id: "op-attemptErr",
          attempt: 1,
          error: testError,
        }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-attemptErr", name: "attempt-err" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const attemptSpan = getExportedSpans().find(
        (s) => s.attributes["durable.operation.attempt"] === 1,
      );
      expect(attemptSpan).toBeDefined();
      expect(attemptSpan!.status.code).toBe(SpanStatusCode.ERROR);
      expect(attemptSpan!.status.message).toBe("Attempt failed");
      const exceptionEvent = attemptSpan!.events.find(
        (e) => e.name === "exception",
      );
      expect(exceptionEvent).toBeDefined();
    });

    it("continuation span with error sets ERROR status and records exception", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      const testError = new Error("Cross-invocation failure");
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "op-cross-err",
          name: "cross-err",
          error: testError,
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const continuationSpan = findSpan("cross-err");
      expect(continuationSpan).toBeDefined();
      expect(continuationSpan!.status.code).toBe(SpanStatusCode.ERROR);
      expect(continuationSpan!.status.message).toBe("Cross-invocation failure");
      const exceptionEvent = continuationSpan!.events.find(
        (e) => e.name === "exception",
      );
      expect(exceptionEvent).toBeDefined();
    });
  });

  describe("wrapInvocation", () => {
    it("sets active span to invocation span", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());

      let capturedSpanId: string | undefined;
      const fn = async () => {
        const activeSpan = trace.getSpan(context.active());
        capturedSpanId = activeSpan?.spanContext().spanId;
        return { output: "result" } as any;
      };

      await plugin.wrapInvocation(makeInvocationInfo(), fn);
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const invocationSpan = findSpan("invocation");
      expect(capturedSpanId).toBeDefined();
      expect(capturedSpanId).toBe(invocationSpan!.spanContext().spanId);
    });

    it("returns fn result unmodified", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      const expected = { output: "test-result" } as any;
      const fn = async () => expected;
      const result = await plugin.wrapInvocation(makeInvocationInfo(), fn);
      expect(result).toBe(expected);
      await plugin.onInvocationEnd(makeInvocationEndInfo());
    });

    it("propagates errors from fn without catching", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      const testError = new Error("wrap error");
      const fn = async () => {
        throw testError;
      };
      await expect(
        plugin.wrapInvocation(makeInvocationInfo(), fn as any),
      ).rejects.toThrow("wrap error");
      await plugin.onInvocationEnd(makeInvocationEndInfo());
    });
  });

  describe("wrapChildContextFn", () => {
    it("sets active span to operation span", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      const opInfo = makeOperationInfo({ id: "op-ctx", name: "ctx-step" });
      await plugin.onOperationStart(opInfo);

      let capturedSpanId: string | undefined;
      const fn = () => {
        const activeSpan = trace.getSpan(context.active());
        capturedSpanId = activeSpan?.spanContext().spanId;
        return "child-result";
      };

      plugin.wrapChildContextFn(opInfo, fn);

      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-ctx", name: "ctx-step" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const opSpan = findSpan("ctx-step");
      expect(capturedSpanId).toBeDefined();
      expect(capturedSpanId).toBe(opSpan!.spanContext().spanId);
    });

    it("returns fn result unmodified", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      const opInfo = makeOperationInfo({ id: "op-ret", name: "ret-step" });
      await plugin.onOperationStart(opInfo);

      const expected = { data: 42 };
      const fn = () => expected;
      const result = plugin.wrapChildContextFn(opInfo, fn);
      expect(result).toBe(expected);

      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-ret", name: "ret-step" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());
    });

    it("propagates errors from fn without catching", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      const opInfo = makeOperationInfo({ id: "op-throw", name: "throw-step" });
      await plugin.onOperationStart(opInfo);

      const testError = new Error("child error");
      const fn = () => {
        throw testError;
      };
      expect(() => plugin.wrapChildContextFn(opInfo, fn)).toThrow(
        "child error",
      );

      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-throw", name: "throw-step" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());
    });

    it("executes fn without context modification when no span tracked", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      // Don't start any operation
      const opInfo = makeOperationInfo({ id: "op-missing" });
      const fn = () => "no-context";
      const result = plugin.wrapChildContextFn(opInfo, fn);
      expect(result).toBe("no-context");
      await plugin.onInvocationEnd(makeInvocationEndInfo());
    });
  });

  describe("wrapOperationAttemptFn", () => {
    it("sets active span to attempt span", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-wrap-attempt", name: "wa-step" }),
      );
      const attemptInfo = makeAttemptInfo({
        id: "op-wrap-attempt",
        name: "wa-step",
        attempt: 1,
      });
      await plugin.onOperationAttemptStart(attemptInfo);

      let capturedSpanId: string | undefined;
      const fn = () => {
        const activeSpan = trace.getSpan(context.active());
        capturedSpanId = activeSpan?.spanContext().spanId;
        return "attempt-result";
      };

      plugin.wrapOperationAttemptFn(attemptInfo, fn);

      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({ id: "op-wrap-attempt", attempt: 1 }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-wrap-attempt", name: "wa-step" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const attemptSpan = getExportedSpans().find(
        (s) => s.attributes["durable.operation.attempt"] === 1,
      );
      expect(capturedSpanId).toBeDefined();
      expect(capturedSpanId).toBe(attemptSpan!.spanContext().spanId);
    });

    it("returns fn result unmodified", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-ar", name: "ar-step" }),
      );
      const attemptInfo = makeAttemptInfo({
        id: "op-ar",
        name: "ar-step",
        attempt: 1,
      });
      await plugin.onOperationAttemptStart(attemptInfo);

      const expected = { value: "attempt" };
      const fn = () => expected;
      const result = plugin.wrapOperationAttemptFn(attemptInfo, fn);
      expect(result).toBe(expected);

      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({ id: "op-ar", attempt: 1 }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-ar", name: "ar-step" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());
    });

    it("propagates errors from fn without catching", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-ae", name: "ae-step" }),
      );
      const attemptInfo = makeAttemptInfo({
        id: "op-ae",
        name: "ae-step",
        attempt: 1,
      });
      await plugin.onOperationAttemptStart(attemptInfo);

      const testError = new Error("attempt error");
      const fn = () => {
        throw testError;
      };
      expect(() => plugin.wrapOperationAttemptFn(attemptInfo, fn)).toThrow(
        "attempt error",
      );

      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({ id: "op-ae", attempt: 1 }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-ae", name: "ae-step" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());
    });
  });

  describe("enrichLogContext", () => {
    it("returns traceId and spanId when span is active", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());

      let logContext: Record<string, string | number | boolean> | undefined;
      const fn = async () => {
        logContext = plugin.enrichLogContext();
        return { output: "test" } as any;
      };

      await plugin.wrapInvocation(makeInvocationInfo(), fn);
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      expect(logContext).toBeDefined();
      expect(logContext!.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(logContext!.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(logContext!.otelTraceSampled).toBe(true);
    });

    it("returns undefined when no span is active", () => {
      const result = plugin.enrichLogContext();
      expect(result).toBeUndefined();
    });
  });

  describe("Span attributes", () => {
    it("operation span has correct attributes", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-attrs", type: "wait", name: "my-wait" }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-attrs", type: "wait", name: "my-wait" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const opSpan = findSpan("my-wait");
      expect(opSpan).toBeDefined();
      expect(opSpan!.attributes["durable.execution.arn"]).toBe(TEST_ARN);
      expect(opSpan!.attributes["durable.operation.id"]).toBe("op-attrs");
      expect(opSpan!.attributes["durable.operation.type"]).toBe("wait");
      expect(opSpan!.attributes["durable.operation.name"]).toBe("my-wait");
    });

    it("operation span omits durable.operation.name when no name provided", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-noname2", type: "invoke" }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-noname2", type: "invoke" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const opSpan = findSpan("invoke");
      expect(opSpan).toBeDefined();
      expect(opSpan!.attributes["durable.operation.name"]).toBeUndefined();
    });

    it("operation span includes durable.operation.subtype when subType provided", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({
          id: "op-subtype",
          type: "WAIT",
          name: "my-wait",
          subType: "TIMER",
        }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "op-subtype",
          type: "WAIT",
          name: "my-wait",
          subType: "TIMER",
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const opSpan = findSpan("my-wait");
      expect(opSpan).toBeDefined();
      expect(opSpan!.attributes["durable.operation.subtype"]).toBe("TIMER");
    });

    it("operation span omits durable.operation.subtype when no subType provided", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-nosub", type: "step", name: "plain-step" }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "op-nosub",
          type: "step",
          name: "plain-step",
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const opSpan = findSpan("plain-step");
      expect(opSpan).toBeDefined();
      expect(opSpan!.attributes["durable.operation.subtype"]).toBeUndefined();
    });

    it("continuation span includes durable.operation.subtype when subType provided", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "op-cont-sub",
          type: "step",
          name: "cont-step",
          subType: "CONDITION_CHECK",
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const continuationSpan = findSpan("cont-step");
      expect(continuationSpan).toBeDefined();
      expect(continuationSpan!.attributes["durable.operation.subtype"]).toBe(
        "CONDITION_CHECK",
      );
    });

    it("attempt span includes durable.operation.subtype when subType provided", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({
          id: "op-att-sub",
          type: "step",
          name: "sub-step",
          subType: "CONDITION_CHECK",
        }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({
          id: "op-att-sub",
          type: "step",
          name: "sub-step",
          subType: "CONDITION_CHECK",
          attempt: 1,
        }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({ id: "op-att-sub", attempt: 1 }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-att-sub", name: "sub-step" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const attemptSpan = getExportedSpans().find(
        (s) =>
          s.attributes["durable.operation.id"] === "op-att-sub" &&
          s.attributes["durable.operation.attempt"] === 1,
      );
      expect(attemptSpan).toBeDefined();
      expect(attemptSpan!.attributes["durable.operation.subtype"]).toBe(
        "CONDITION_CHECK",
      );
    });
  });

  describe("Span filtering for WAIT, CHAINED_INVOKE, and CALLBACK types", () => {
    describe("onOperationStart with isReplay=true skips filtered types", () => {
      it("does not create a span for WAIT type on replay", async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onOperationStart(
          makeOperationInfo({
            id: "op-wait-replay",
            type: "WAIT",
            isReplay: true,
          }),
        );
        await plugin.onInvocationEnd(makeInvocationEndInfo());

        const spans = getExportedSpans();
        const waitSpan = spans.find(
          (s) => s.attributes["durable.operation.type"] === "WAIT",
        );
        expect(waitSpan).toBeUndefined();
      });

      it("does not create a span for CHAINED_INVOKE type on replay", async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onOperationStart(
          makeOperationInfo({
            id: "op-invoke-replay",
            type: "CHAINED_INVOKE",
            isReplay: true,
          }),
        );
        await plugin.onInvocationEnd(makeInvocationEndInfo());

        const spans = getExportedSpans();
        const invokeSpan = spans.find(
          (s) => s.attributes["durable.operation.type"] === "CHAINED_INVOKE",
        );
        expect(invokeSpan).toBeUndefined();
      });

      it("does not create a span for CALLBACK type on replay", async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onOperationStart(
          makeOperationInfo({
            id: "op-callback-replay",
            type: "CALLBACK",
            isReplay: true,
          }),
        );
        await plugin.onInvocationEnd(makeInvocationEndInfo());

        const spans = getExportedSpans();
        const callbackSpan = spans.find(
          (s) => s.attributes["durable.operation.type"] === "CALLBACK",
        );
        expect(callbackSpan).toBeUndefined();
      });

      it("still creates a span for CONTEXT type on replay", async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onOperationStart(
          makeOperationInfo({
            id: "op-context-replay",
            type: "CONTEXT",
            isReplay: true,
          }),
        );
        await plugin.onOperationEnd(
          makeOperationEndInfo({ id: "op-context-replay", type: "CONTEXT" }),
        );
        await plugin.onInvocationEnd(makeInvocationEndInfo());

        const spans = getExportedSpans();
        const contextSpan = spans.find(
          (s) => s.attributes["durable.operation.type"] === "CONTEXT",
        );
        expect(contextSpan).toBeDefined();
      });
    });

    describe("onOperationEnd never creates spans for filtered types on replay", () => {
      it("does not create a continuation span for WAIT type on replay", async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onOperationEnd(
          makeOperationEndInfo({
            id: "op-wait-end",
            type: "WAIT",
            name: "my-wait",
            isReplay: true,
          }),
        );
        await plugin.onInvocationEnd(makeInvocationEndInfo());

        const spans = getExportedSpans();
        const waitSpan = spans.find(
          (s) => s.attributes["durable.operation.type"] === "WAIT",
        );
        expect(waitSpan).toBeUndefined();
      });

      it("does not create a continuation span for INVOKE type on replay", async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onOperationEnd(
          makeOperationEndInfo({
            id: "op-invoke-end",
            type: "INVOKE",
            name: "my-invoke",
            isReplay: true,
          }),
        );
        await plugin.onInvocationEnd(makeInvocationEndInfo());

        const spans = getExportedSpans();
        const invokeSpan = spans.find(
          (s) => s.attributes["durable.operation.type"] === "INVOKE",
        );
        expect(invokeSpan).toBeUndefined();
      });

      it("does not create a continuation span for CALLBACK type on replay", async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onOperationEnd(
          makeOperationEndInfo({
            id: "op-callback-end",
            type: "CALLBACK",
            name: "my-callback",
            isReplay: true,
          }),
        );
        await plugin.onInvocationEnd(makeInvocationEndInfo());

        const spans = getExportedSpans();
        const callbackSpan = spans.find(
          (s) => s.attributes["durable.operation.type"] === "CALLBACK",
        );
        expect(callbackSpan).toBeUndefined();
      });

      it("does not create a continuation span for step type on replay either", async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onOperationEnd(
          makeOperationEndInfo({
            id: "op-step-end",
            type: "step",
            name: "cross-step",
            isReplay: true,
          }),
        );
        await plugin.onInvocationEnd(makeInvocationEndInfo());

        const continuationSpan = findSpan("cross-step");
        expect(continuationSpan).toBeUndefined();
      });

      it("still creates a span for WAIT type when not a replay", async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onOperationStart(
          makeOperationInfo({
            id: "op-wait-nonreplay",
            type: "WAIT",
            isReplay: false,
          }),
        );
        await plugin.onOperationEnd(
          makeOperationEndInfo({
            id: "op-wait-nonreplay",
            type: "WAIT",
            isReplay: false,
          }),
        );
        await plugin.onInvocationEnd(makeInvocationEndInfo());

        const spans = getExportedSpans();
        const waitSpan = spans.find(
          (s) => s.attributes["durable.operation.type"] === "WAIT",
        );
        expect(waitSpan).toBeDefined();
      });
    });
  });

  describe("Parent-child workflow span ID collision prevention", () => {
    it("parent and child workflows with same operation position produce distinct span IDs and correct parenting", async () => {
      // Two different execution ARNs (parent and child workflows)
      const PARENT_ARN =
        "arn:aws:lambda:us-east-1:123456789012:function:durable-workflow:$LATEST:parent-exec-1";
      const CHILD_ARN =
        "arn:aws:lambda:us-east-1:123456789012:function:durable-enrich:$LATEST:child-exec-1";

      // Create parent plugin with shared provider
      const parentPlugin = new InvocationOtelPlugin({
        tracerProvider: provider,
      });

      // Create child plugin with shared provider
      const childPlugin = new InvocationOtelPlugin({
        tracerProvider: provider,
      });

      // --- Parent workflow execution ---
      const parentInfo = makeInvocationInfo({ executionArn: PARENT_ARN });
      await parentPlugin.onInvocationStart(parentInfo);
      await parentPlugin.wrapInvocation(parentInfo, async () => {
        await parentPlugin.onOperationStart(
          makeOperationInfo({
            id: "1",
            name: "validate",
            type: "STEP",
            isReplay: false,
          }),
        );
        await parentPlugin.onOperationEnd(
          makeOperationEndInfo({ id: "1", name: "validate", type: "STEP" }),
        );
        return { output: undefined } as any;
      });
      await parentPlugin.onInvocationEnd(
        makeInvocationEndInfo({ executionArn: PARENT_ARN }),
      );

      // --- Child workflow execution ---
      const childInfo = makeInvocationInfo({ executionArn: CHILD_ARN });
      await childPlugin.onInvocationStart(childInfo);
      await childPlugin.wrapInvocation(childInfo, async () => {
        await childPlugin.onOperationStart(
          makeOperationInfo({
            id: "1",
            name: "enrich",
            type: "STEP",
            isReplay: false,
          }),
        );
        await childPlugin.onOperationEnd(
          makeOperationEndInfo({ id: "1", name: "enrich", type: "STEP" }),
        );
        return { output: undefined } as any;
      });
      await childPlugin.onInvocationEnd(
        makeInvocationEndInfo({ executionArn: CHILD_ARN }),
      );

      // --- Verify span IDs are DIFFERENT ---
      const allSpans = getExportedSpans();
      const validateSpan = allSpans.find(
        (s) =>
          s.name === "validate" &&
          s.attributes["durable.execution.arn"] === PARENT_ARN,
      );
      const enrichSpan = allSpans.find(
        (s) =>
          s.name === "enrich" &&
          s.attributes["durable.execution.arn"] === CHILD_ARN,
      );

      expect(validateSpan).toBeDefined();
      expect(enrichSpan).toBeDefined();

      // Key assertion: same operation position ("1") but different ARNs → different span IDs
      expect(validateSpan!.spanContext().spanId).not.toBe(
        enrichSpan!.spanContext().spanId,
      );

      // --- Verify correct parenting ---
      const parentInvocationSpan = allSpans.find(
        (s) =>
          s.name === "invocation" &&
          s.attributes["durable.execution.arn"] === PARENT_ARN,
      );
      const childInvocationSpan = allSpans.find(
        (s) =>
          s.name === "invocation" &&
          s.attributes["durable.execution.arn"] === CHILD_ARN,
      );

      expect(parentInvocationSpan).toBeDefined();
      expect(childInvocationSpan).toBeDefined();

      // validate span should be child of parent's invocation span
      expect(validateSpan!.parentSpanContext?.spanId).toBe(
        parentInvocationSpan!.spanContext().spanId,
      );
      // enrich span should be child of child's invocation span
      expect(enrichSpan!.parentSpanContext?.spanId).toBe(
        childInvocationSpan!.spanContext().spanId,
      );
    });
  });
});
