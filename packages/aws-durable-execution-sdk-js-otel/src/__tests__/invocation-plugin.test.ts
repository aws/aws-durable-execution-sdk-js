import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import {
  context,
  trace,
  SpanStatusCode,
  SpanKind,
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
    isFirstInvocation: true,
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
      const invocationSpan = findSpan("Invocation");
      expect(invocationSpan).toBeDefined();
      expect(invocationSpan!.attributes["durable.execution.arn"]).toBe(
        TEST_ARN,
      );
    });

    it('creates invocation span with correct name "Invocation"', async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const invocationSpan = findSpan("Invocation");
      expect(invocationSpan).toBeDefined();
      expect(invocationSpan!.name).toBe("Invocation");
    });

    it("honors custom workflowSpanName from config; invocation span name is fixed", async () => {
      const customPlugin = new InvocationOtelPlugin({
        tracerProvider: provider,
        workflowSpanName: "my-workflow",
      });
      await customPlugin.onInvocationStart(makeInvocationInfo());
      await customPlugin.onInvocationEnd(makeInvocationEndInfo());

      expect(findSpan("my-workflow")).toBeDefined();
      expect(findSpan("Workflow")).toBeUndefined();
      // Invocation span name is not configurable; always "Invocation"
      expect(findSpan("Invocation")).toBeDefined();
    });
  });

  describe("Invocation span status mapping (PluginInvocationStatus -> OTel span status)", () => {
    it.each([
      ["SUCCEEDED", SpanStatusCode.OK],
      ["PENDING", SpanStatusCode.OK],
    ])("maps %s -> invocation span status OK", async (status, expected) => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: status as any }),
      );

      const invocationSpan = findSpan("Invocation");
      expect(invocationSpan).toBeDefined();
      expect(invocationSpan!.status.code).toBe(expected);
    });

    it("maps RETRYING -> invocation span status UNSET (STOPPED/TIMED_OUT indistinguishable from RETRYING)", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "RETRYING" as any }),
      );

      const invocationSpan = findSpan("Invocation");
      expect(invocationSpan).toBeDefined();
      expect(invocationSpan!.status.code).toBe(SpanStatusCode.UNSET);
    });

    it("maps FAILED -> invocation span status ERROR with the execution error message", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({
          status: "FAILED" as any,
          executionError: new Error("invocation boom"),
        }),
      );

      const invocationSpan = findSpan("Invocation");
      expect(invocationSpan).toBeDefined();
      expect(invocationSpan!.status.code).toBe(SpanStatusCode.ERROR);
      expect(invocationSpan!.status.message).toBe("invocation boom");
    });
  });

  describe("Workflow span status mapping (PluginInvocationStatus -> OTel span status)", () => {
    it("creates the Workflow span with SpanKind.INTERNAL", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
      );

      const workflowSpan = findSpan("Workflow");
      expect(workflowSpan).toBeDefined();
      expect(workflowSpan!.kind).toBe(SpanKind.INTERNAL);
    });

    it("maps SUCCEEDED -> Workflow span status OK", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
      );

      const workflowSpan = findSpan("Workflow");
      expect(workflowSpan).toBeDefined();
      expect(workflowSpan!.status.code).toBe(SpanStatusCode.OK);
      expect(workflowSpan!.attributes["durable.execution.status"]).toBe(
        "SUCCEEDED",
      );
    });

    it("maps FAILED -> Workflow span status ERROR with the execution error message", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({
          status: "FAILED" as any,
          executionError: new Error("kaboom"),
        }),
      );

      const workflowSpan = findSpan("Workflow");
      expect(workflowSpan).toBeDefined();
      expect(workflowSpan!.status.code).toBe(SpanStatusCode.ERROR);
      expect(workflowSpan!.status.message).toBe("kaboom");
      expect(workflowSpan!.attributes["durable.execution.status"]).toBe(
        "FAILED",
      );
    });

    it.each(["PENDING", "RETRYING"])(
      "leaves the Workflow span un-ended (UNSET, never exported) for non-terminal status %s",
      async (status) => {
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onInvocationEnd(
          makeInvocationEndInfo({ status: status as any }),
        );

        expect(findSpan("Workflow")).toBeUndefined();
      },
    );
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
      expect(findSpan("Invocation")).toBeDefined();
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
      const invocationSpan = findSpan("Invocation");
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
      // Non-replay spans carry no self-link, but do link to the Workflow span
      // for execution correlation.
      const workflowSpan = findSpan("Workflow");
      expect(opSpan!.links.length).toBe(1);
      expect(opSpan!.links[0].context.spanId).toBe(
        workflowSpan!.spanContext().spanId,
      );
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

  describe("durable.operation.status semantics", () => {
    it("stamps STARTED at start and the terminal status on a completed STEP", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "s1", type: "STEP", name: "my-step" }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "s1",
          type: "STEP",
          name: "my-step",
          status: "SUCCEEDED" as any,
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      expect(findSpan("my-step")!.attributes["durable.operation.status"]).toBe(
        "SUCCEEDED",
      );
    });

    it("reports terminal SUCCEEDED for a container CONTEXT operation that completes", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({
          id: "c1",
          type: "CONTEXT",
          name: "my-ctx",
          subType: "RunInChildContext",
        }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "c1",
          type: "CONTEXT",
          name: "my-ctx",
          // The core (run-in-child-context-handler) supplies the terminal
          // status for containers on both the virtual and non-virtual paths.
          status: "SUCCEEDED" as any,
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      expect(findSpan("my-ctx")!.attributes["durable.operation.status"]).toBe(
        "SUCCEEDED",
      );
    });

    it("reports terminal FAILED for a container CONTEXT operation that errors", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({
          id: "c2",
          type: "CONTEXT",
          name: "bad-ctx",
          subType: "RunInChildContext",
        }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "c2",
          type: "CONTEXT",
          name: "bad-ctx",
          status: "FAILED" as any,
          error: new Error("child context failed"),
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      expect(findSpan("bad-ctx")!.attributes["durable.operation.status"]).toBe(
        "FAILED",
      );
    });

    it("attempt spans carry only durable.attempt.outcome, not durable.operation.status", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "s2", type: "STEP", name: "retry-step" }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({ id: "s2", type: "STEP", name: "retry-step", attempt: 1 }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({
          id: "s2",
          type: "STEP",
          name: "retry-step",
          attempt: 1,
          outcome: "SUCCEEDED" as any,
        }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "s2",
          type: "STEP",
          name: "retry-step",
          status: "SUCCEEDED" as any,
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const attemptSpan = findSpan("retry-step attempt 1");
      expect(
        attemptSpan!.attributes["durable.operation.status"],
      ).toBeUndefined();
      expect(attemptSpan!.attributes["durable.attempt.outcome"]).toBe(
        "SUCCEEDED",
      );
    });

    it("keeps STARTED for a suspended (never-resumed) operation", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "w1", type: "WAIT", name: "my-wait" }),
      );
      // Operation suspends: no onOperationEnd fires this invocation.
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "PENDING" as any }),
      );

      expect(findSpan("my-wait")!.attributes["durable.operation.status"]).toBe(
        "STARTED",
      );
    });
  });

  describe("operation span timing envelope", () => {
    it("times operation spans with wall-clock so they nest within the Invocation span", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({
          id: "op-t",
          type: "STEP",
          name: "timed-step",
          // Durable timestamp deliberately predates this invocation.
          startTimestamp: new Date(Date.now() - 60_000),
        }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "op-t",
          type: "STEP",
          name: "timed-step",
          status: "SUCCEEDED" as any,
          endTimestamp: new Date(Date.now() + 60_000),
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const inv = findSpan("Invocation")!;
      const op = findSpan("timed-step")!;
      const toMs = (t: [number, number]): number => t[0] * 1000 + t[1] / 1e6;
      // The op span is NOT backdated to the durable timestamp; it nests inside
      // the Invocation span's wall-clock [start, end] window.
      expect(toMs(op.startTime)).toBeGreaterThanOrEqual(toMs(inv.startTime));
      expect(toMs(op.endTime)).toBeLessThanOrEqual(toMs(inv.endTime));
    });
  });

  describe("same-invocation replay deduplication", () => {
    it("reuses the operation span across a non-replay then replay start (single terminal span, attempts share it)", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());

      // Non-replay start creates the operation span.
      await plugin.onOperationStart(
        makeOperationInfo({
          id: "op-r",
          type: "STEP",
          name: "retried-op",
          isReplay: false,
        }),
      );
      // Attempt 1 (fails) — child of the operation span.
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({ id: "op-r", type: "STEP", name: "retried-op", attempt: 1 }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({
          id: "op-r",
          type: "STEP",
          name: "retried-op",
          attempt: 1,
          outcome: "FAILED" as any,
        }),
      );
      // Same-invocation replay start for the SAME operation id must NOT create
      // a duplicate span (dedupe guard in onOperationStart).
      await plugin.onOperationStart(
        makeOperationInfo({
          id: "op-r",
          type: "STEP",
          name: "retried-op",
          isReplay: true,
        }),
      );
      // Attempt 2 (succeeds) after the replay.
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({ id: "op-r", type: "STEP", name: "retried-op", attempt: 2 }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({
          id: "op-r",
          type: "STEP",
          name: "retried-op",
          attempt: 2,
          outcome: "SUCCEEDED" as any,
        }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "op-r",
          type: "STEP",
          name: "retried-op",
          status: "SUCCEEDED" as any,
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      // Exactly one terminal operation span — the replay start did not
      // duplicate it.
      const opSpans = getExportedSpans().filter((s) => s.name === "retried-op");
      expect(opSpans).toHaveLength(1);
      expect(opSpans[0].attributes["durable.operation.status"]).toBe(
        "SUCCEEDED",
      );

      // Both attempt spans parent to that single operation span.
      const opSpanId = opSpans[0].spanContext().spanId;
      const attempt1 = findSpan("retried-op attempt 1");
      const attempt2 = findSpan("retried-op attempt 2");
      expect(attempt1!.parentSpanContext?.spanId).toBe(opSpanId);
      expect(attempt2!.parentSpanContext?.spanId).toBe(opSpanId);
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

  describe("Parent-child resolution with parentId", () => {
    it("operation with parentId in map becomes child of that parent span", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      // Start parent operation
      await plugin.onOperationStart(
        makeOperationInfo({ id: "parent-op", name: "parent" }),
      );
      // Start child operation with parentId referencing parent-op
      await plugin.onOperationStart(
        makeOperationInfo({
          id: "child-op",
          name: "child",
          parentId: "parent-op",
        }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "child-op", name: "child" }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "parent-op", name: "parent" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const parentSpan = findSpan("parent");
      const childSpan = findSpan("child");
      expect(parentSpan).toBeDefined();
      expect(childSpan).toBeDefined();
      expect(childSpan!.parentSpanContext?.spanId).toBe(
        parentSpan!.spanContext().spanId,
      );
    });

    it("operation with parentId NOT in map becomes child of invocation span", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      // Start operation with parentId that doesn't exist in map
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

      const invocationSpan = findSpan("Invocation");
      const orphanSpan = findSpan("orphan");
      expect(invocationSpan).toBeDefined();
      expect(orphanSpan).toBeDefined();
      expect(orphanSpan!.parentSpanContext?.spanId).toBe(
        invocationSpan!.spanContext().spanId,
      );
    });

    it("operation with no parentId becomes child of invocation span", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "root-op", name: "root-child" }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "root-op", name: "root-child" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const invocationSpan = findSpan("Invocation");
      const rootOpSpan = findSpan("root-child");
      expect(invocationSpan).toBeDefined();
      expect(rootOpSpan).toBeDefined();
      expect(rootOpSpan!.parentSpanContext?.spanId).toBe(
        invocationSpan!.spanContext().spanId,
      );
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
        (s) => s.name === "my-step" && !s.attributes["durable.attempt.number"],
      );
      const attemptSpan = spans.find(
        (s) => s.attributes["durable.attempt.number"] === 1,
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
        (s) => s.attributes["durable.attempt.number"] === 2,
      );
      expect(attemptSpan).toBeDefined();
      expect(attemptSpan!.attributes["durable.execution.arn"]).toBe(TEST_ARN);
      expect(attemptSpan!.attributes["durable.operation.type"]).toBe("step");
      expect(attemptSpan!.attributes["durable.operation.name"]).toBe(
        "attr-step",
      );
      expect(attemptSpan!.attributes["durable.attempt.number"]).toBe(2);
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
        (s) => s.attributes["durable.attempt.number"] === 1,
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
        (s) => s.attributes["durable.attempt.number"] === 1,
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
        (s) => s.attributes["durable.attempt.number"] === 3,
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
          s.attributes["durable.attempt.number"] === 1,
      );
      expect(attemptSpan).toBeDefined();
      expect(attemptSpan!.name).toBe("step attempt 1");
    });

    it("handles interleaved attempt starts and ends for different operations", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-a", name: "step-a", type: "step" }),
      );
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-b", name: "step-b", type: "step" }),
      );

      // Start attempt for op-a
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({
          id: "op-a",
          name: "step-a",
          type: "step",
          attempt: 1,
        }),
      );
      // Start attempt for op-b (interleaved)
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({
          id: "op-b",
          name: "step-b",
          type: "step",
          attempt: 1,
        }),
      );

      // End attempt for op-a first
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({
          id: "op-a",
          attempt: 1,
          outcome: "SUCCEEDED" as any,
        }),
      );
      // End attempt for op-b second
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({
          id: "op-b",
          attempt: 1,
          outcome: "FAILED" as any,
          error: new Error("op-b failed"),
        }),
      );

      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-a", name: "step-a" }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-b", name: "step-b" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const spans = getExportedSpans();

      // Find attempt spans by operation ID
      const attemptA = spans.find(
        (s) =>
          s.attributes["durable.operation.id"] === "op-a" &&
          s.attributes["durable.attempt.number"] === 1,
      );
      const attemptB = spans.find(
        (s) =>
          s.attributes["durable.operation.id"] === "op-b" &&
          s.attributes["durable.attempt.number"] === 1,
      );

      expect(attemptA).toBeDefined();
      expect(attemptB).toBeDefined();

      // Each attempt span should have its own correct outcome
      expect(attemptA!.attributes["durable.attempt.outcome"]).toBe("SUCCEEDED");
      expect(attemptB!.attributes["durable.attempt.outcome"]).toBe("FAILED");

      // op-b attempt should have error status
      expect(attemptB!.status.code).toBe(SpanStatusCode.ERROR);
      expect(attemptB!.status.message).toBe("op-b failed");

      // op-a attempt should NOT have error status
      expect(attemptA!.status.code).not.toBe(SpanStatusCode.ERROR);

      // Each attempt should be parented to its own operation span
      const opASpan = spans.find(
        (s) => s.name === "step-a" && !s.attributes["durable.attempt.number"],
      );
      const opBSpan = spans.find(
        (s) => s.name === "step-b" && !s.attributes["durable.attempt.number"],
      );
      expect(attemptA!.parentSpanContext?.spanId).toBe(
        opASpan!.spanContext().spanId,
      );
      expect(attemptB!.parentSpanContext?.spanId).toBe(
        opBSpan!.spanContext().spanId,
      );
    });

    it("handles interleaved attempts with different attempt numbers for the same operation", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-multi", name: "multi-step", type: "step" }),
      );

      // Start attempt 1
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({
          id: "op-multi",
          name: "multi-step",
          type: "step",
          attempt: 1,
        }),
      );
      // End attempt 1
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({
          id: "op-multi",
          attempt: 1,
          outcome: "FAILED" as any,
          error: new Error("retry needed"),
        }),
      );

      // Start attempt 2
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({
          id: "op-multi",
          name: "multi-step",
          type: "step",
          attempt: 2,
        }),
      );
      // End attempt 2
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({
          id: "op-multi",
          attempt: 2,
          outcome: "SUCCEEDED" as any,
        }),
      );

      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-multi", name: "multi-step" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const spans = getExportedSpans();

      const attempt1 = spans.find(
        (s) =>
          s.attributes["durable.operation.id"] === "op-multi" &&
          s.attributes["durable.attempt.number"] === 1,
      );
      const attempt2 = spans.find(
        (s) =>
          s.attributes["durable.operation.id"] === "op-multi" &&
          s.attributes["durable.attempt.number"] === 2,
      );

      expect(attempt1).toBeDefined();
      expect(attempt2).toBeDefined();

      // Attempt 1 failed, attempt 2 succeeded
      expect(attempt1!.attributes["durable.attempt.outcome"]).toBe("FAILED");
      expect(attempt1!.status.code).toBe(SpanStatusCode.ERROR);
      expect(attempt2!.attributes["durable.attempt.outcome"]).toBe("SUCCEEDED");
      expect(attempt2!.status.code).not.toBe(SpanStatusCode.ERROR);

      // Both should have correct names
      expect(attempt1!.name).toBe("multi-step attempt 1");
      expect(attempt2!.name).toBe("multi-step attempt 2");
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
          s.attributes["durable.attempt.number"] === 1,
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
          s.attributes["durable.attempt.number"] === 1,
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
          outcome: "FAILED" as any,
          error: testError,
        }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-attemptErr", name: "attempt-err" }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const attemptSpan = getExportedSpans().find(
        (s) => s.attributes["durable.attempt.number"] === 1,
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

    // Regression: onOperationEnd can be reached with a terminal FAILURE status
    // (TIMED_OUT/STOPPED/FAILED/CANCELLED) and NO error object (callback-timeout
    // and chained-invoke "already failed" cross-invocation fast paths). Those
    // must NOT be labelled OTel OK — the OK branch is gated on SUCCEEDED, so a
    // no-error failure leaves the span status at the default UNSET (code 0).
    it("onOperationEnd terminal path: TIMED_OUT status with NO error leaves the operation span NOT OK (UNSET)", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-timeout", name: "timeout-op" }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "op-timeout",
          name: "timeout-op",
          status: "TIMED_OUT" as any,
          // no error object
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const opSpan = findSpan("timeout-op");
      expect(opSpan).toBeDefined();
      expect(opSpan!.status.code).not.toBe(SpanStatusCode.OK);
      expect(opSpan!.status.code).toBe(SpanStatusCode.UNSET);
    });

    it("onOperationEnd continuation path: STOPPED status with NO error leaves the continuation span NOT OK (UNSET)", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      // No prior onOperationStart -> spanMap miss -> cross-invocation
      // continuation span path.
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "op-cross-stopped",
          name: "cross-stopped",
          status: "STOPPED" as any,
          // no error object
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const continuationSpan = findSpan("cross-stopped");
      expect(continuationSpan).toBeDefined();
      expect(continuationSpan!.status.code).not.toBe(SpanStatusCode.OK);
      expect(continuationSpan!.status.code).toBe(SpanStatusCode.UNSET);
    });

    it("onOperationEnd terminal path: SUCCEEDED status with NO error stamps OK", async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-ok", name: "ok-op" }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "op-ok",
          name: "ok-op",
          status: "SUCCEEDED" as any,
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const opSpan = findSpan("ok-op");
      expect(opSpan).toBeDefined();
      expect(opSpan!.status.code).toBe(SpanStatusCode.OK);
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

      const invocationSpan = findSpan("Invocation");
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
        (s) => s.attributes["durable.attempt.number"] === 1,
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

    it("returns undefined when enrichLogger is disabled, even with an active span", async () => {
      const noEnrichPlugin = new InvocationOtelPlugin({
        tracerProvider: provider,
        enrichLogger: false,
      });
      await noEnrichPlugin.onInvocationStart(makeInvocationInfo());

      let logContext: Record<string, string | number | boolean> | undefined;
      const fn = async () => {
        logContext = noEnrichPlugin.enrichLogContext();
        return { output: "test" } as any;
      };

      await noEnrichPlugin.wrapInvocation(makeInvocationInfo(), fn);
      await noEnrichPlugin.onInvocationEnd(makeInvocationEndInfo());

      expect(logContext).toBeUndefined();
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
          s.attributes["durable.attempt.number"] === 1,
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
      await parentPlugin.onInvocationStart(
        makeInvocationInfo({ executionArn: PARENT_ARN }),
      );
      // Parent has operation at position "1" (same as child will have)
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
      await parentPlugin.onInvocationEnd(
        makeInvocationEndInfo({ executionArn: PARENT_ARN }),
      );

      // --- Child workflow execution ---
      await childPlugin.onInvocationStart(
        makeInvocationInfo({ executionArn: CHILD_ARN }),
      );
      // Child also has operation at position "1"
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
          s.name === "Invocation" &&
          s.attributes["durable.execution.arn"] === PARENT_ARN,
      );
      const childInvocationSpan = allSpans.find(
        (s) =>
          s.name === "Invocation" &&
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
