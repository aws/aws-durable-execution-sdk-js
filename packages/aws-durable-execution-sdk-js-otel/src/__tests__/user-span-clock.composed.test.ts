import type {
  AttemptInfo,
  InvocationInfo,
  OperationInfo,
} from "@aws/durable-execution-sdk-js";
import { InvocationStatus } from "@aws/durable-execution-sdk-js";
import {
  context,
  propagation,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type { HrTime } from "@opentelemetry/api";
import { otperformance, timeInputToHrTime } from "@opentelemetry/core";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import type { IdGenerator, ReadableSpan } from "@opentelemetry/sdk-trace-node";
import { createExecutionOtelPluginFactory } from "../execution-plugin";
import {
  InvocationOtelPlugin,
  createInvocationOtelPluginFactory,
} from "../invocation-plugin";
import {
  deriveSpanIdFromOperationId,
  deriveWorkflowSpanId,
} from "../deterministic-id-generator";

function nanoseconds(time: HrTime): bigint {
  return BigInt(time[0]) * 1_000_000_000n + BigInt(time[1]);
}

function expectChildOf(
  child: ReadableSpan,
  parent: ReadableSpan,
  userClockPrecision = 0n,
): void {
  expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
  expect(child.spanContext().traceId).toBe(parent.spanContext().traceId);
  // SDK hierarchy stays strict. Ordinary user spans use the conformance
  // contract's existing 1 ms precision for both boundaries of their wall clock.
  expect(nanoseconds(child.startTime)).toBeGreaterThanOrEqual(
    nanoseconds(parent.startTime) - userClockPrecision,
  );
  expect(
    nanoseconds(child.endTime) - nanoseconds(parent.endTime),
  ).toBeLessThanOrEqual(userClockPrecision);
}

// A backend-timestamped synthetic root is a zero-duration identity anchor;
// temporal containment continues to apply to the live SDK and user spans.
function expectAnchoredTo(child: ReadableSpan, root: ReadableSpan): void {
  expect(child.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
  expect(child.spanContext().traceId).toBe(root.spanContext().traceId);
  expect(root.parentSpanContext).toBeUndefined();
  expect(root.endTime).toEqual(root.startTime);
  expect(root.duration).toEqual([0, 0]);
  expect(root.attributes["durable.execution.arn"]).toBe(
    child.attributes["durable.execution.arn"],
  );
}

describe.each([
  ["invocation", createInvocationOtelPluginFactory],
  ["execution", createExecutionOtelPluginFactory],
] as const)("%s view user span clocks", (view, createFactory) => {
  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;
  let timeOriginDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    timeOriginDescriptor = Object.getOwnPropertyDescriptor(
      otperformance,
      "timeOrigin",
    );
    exporter = new InMemorySpanExporter();
  });

  afterEach(async () => {
    if (timeOriginDescriptor) {
      Object.defineProperty(otperformance, "timeOrigin", timeOriginDescriptor);
    } else {
      Reflect.deleteProperty(otperformance, "timeOrigin");
    }
    await provider.shutdown();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it.each([
    ["global", 10],
    ["global", -10],
    ["factory", 10],
    ["factory", -10],
  ] as const)(
    "contains ordinary user spans across resume with %s provider and %i ms origin offset",
    async (providerMode, offset) => {
      // Reproduce a process performance epoch that has drifted from wall time.
      // Date and performance.now() still advance normally. The real OTel SDK
      // and public user tracer run unchanged; only the clock origin differs.
      Object.defineProperty(otperformance, "timeOrigin", {
        configurable: true,
        value: otperformance.timeOrigin + offset,
      });
      const registerProvider = (idGenerator?: IdGenerator) => {
        provider = new NodeTracerProvider({
          idGenerator,
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        });
        provider.register();
        return provider;
      };
      if (providerMode === "global") registerProvider();
      const factory = createFactory({
        contextExtractor: () => undefined,
        ...(providerMode === "factory"
          ? {
              tracerProviderFactory: (createIdGenerator: () => IdGenerator) =>
                registerProvider(createIdGenerator()),
            }
          : {}),
      });
      const userTracer = trace.getTracer("user-clock-regression");
      const probe = (name: string) => {
        // No explicit parent, startTime, endTime, or context repair.
        const span = userTracer.startSpan(name);
        span.end();
      };
      const executionStartTimestamp = new Date();
      const base = {
        executionArn:
          "arn:aws:lambda:us-east-1:123456789012:function:clock:$LATEST/durable-execution/clock",
        executionInput: {},
        operations: {},
        updatedOperations: {},
        executionStartTimestamp,
      };
      const contextStart = new Date();
      const operationStart = new Date();
      for (const attempt of [1, 2]) {
        const info: InvocationInfo = {
          ...base,
          requestId: `request-${attempt}`,
          isFirstInvocation: attempt === 1,
        };
        const childInfo: OperationInfo = {
          id: "context",
          type: "CONTEXT",
          name: "child-context",
          isReplay: attempt === 2,
          startTimestamp: contextStart,
        };
        const operation: OperationInfo = {
          id: "step",
          parentId: childInfo.id,
          type: "STEP",
          name: "retry-step",
          isReplay: attempt === 2,
          startTimestamp: operationStart,
        };
        const attemptInfo: AttemptInfo = {
          ...operation,
          attempt,
          startTimestamp: new Date(),
        };
        const plugin = factory.createPlugin(info);
        await plugin.onInvocationStart(info);
        await plugin.wrapInvocation(info, async () => {
          probe(`user-handler-${attempt}`);
          await plugin.onOperationStart(childInfo);
          await plugin.wrapChildContextFn(childInfo, async () => {
            probe(`user-context-${attempt}`);
            const wait: OperationInfo = {
              id: "wait",
              parentId: childInfo.id,
              type: "WAIT",
              name: "suspended-wait",
              isReplay: false,
              startTimestamp: contextStart,
            };
            if (attempt === 1) {
              await plugin.onOperationStart(wait);
            } else {
              // The external operation completes in this invocation without
              // a live start, exercising createInvocationOtelPluginFactory's continuation.
              await plugin.onOperationEnd({
                ...wait,
                status: "SUCCEEDED",
                endTimestamp: new Date(),
              });
            }
            await plugin.onOperationStart(operation);
            await plugin.onOperationAttemptStart(attemptInfo);
            await plugin.wrapOperationAttemptFn(attemptInfo, async () => {
              await Promise.resolve();
              probe(`user-attempt-${attempt}`);
            });
            await plugin.onOperationAttemptEnd({
              ...attemptInfo,
              outcome: attempt === 1 ? "FAILED" : "SUCCEEDED",
              endTimestamp: new Date(),
              ...(attempt === 1 ? { error: new Error("retry") } : {}),
            });
            if (attempt === 2) {
              await plugin.onOperationEnd({
                ...operation,
                status: "SUCCEEDED",
                endTimestamp: new Date(),
              });
            }
          });
          if (attempt === 2) {
            await plugin.onOperationEnd({
              ...childInfo,
              status: "SUCCEEDED",
              endTimestamp: new Date(),
            });
          }
          return {
            Status:
              attempt === 1
                ? InvocationStatus.PENDING
                : InvocationStatus.SUCCEEDED,
          };
        });
        await plugin.onInvocationEnd({
          ...info,
          status: attempt === 1 ? "PENDING" : "SUCCEEDED",
        });
        if (view === "invocation" && attempt === 1) {
          const finished = exporter.getFinishedSpans();
          const invocation = finished.find(
            (span) => span.name === "Invocation",
          )!;
          for (const name of [
            "child-context",
            "retry-step",
            "suspended-wait",
          ]) {
            expect(
              finished.find((span) => span.name === name)?.endTime,
            ).toEqual(invocation.endTime);
          }
        }
      }

      const spans = exporter.getFinishedSpans();
      const userSpans = spans.filter((span) => span.name.startsWith("user-"));
      expect(userSpans).toHaveLength(6);
      const expectedParent = (span: ReadableSpan) => {
        if (span.name.startsWith("user-handler"))
          return view === "invocation" ? "Invocation" : "Workflow";
        if (span.name.startsWith("user-context")) return "child-context";
        return `retry-step attempt ${span.name.at(-1)}`;
      };
      for (const child of userSpans) {
        const parents = spans.filter(
          (span) =>
            span.spanContext().spanId === child.parentSpanContext?.spanId,
        );
        expect(parents).toHaveLength(1);
        expect(parents[0].name).toBe(expectedParent(child));
        expectChildOf(child, parents[0], 1_000_000n);
      }
      const wait = spans
        .filter((span) => span.name === "suspended-wait")
        .at(-1)!;
      const waitParent = spans.find(
        (span) => span.spanContext().spanId === wait.parentSpanContext?.spanId,
      )!;
      expect(waitParent.name).toBe("child-context");
      expectChildOf(wait, waitParent);
      expect(spans.filter((span) => span.name === "Invocation")).toHaveLength(
        2,
      );
      expect(spans.filter((span) => span.name === "Workflow")).toHaveLength(1);
      expect(
        spans.filter((span) => span.name === "retry-step attempt 1"),
      ).toHaveLength(1);
      expect(
        spans.filter((span) => span.name === "retry-step attempt 2"),
      ).toHaveLength(1);
    },
  );
});

describe.each([10, -10])(
  "invocation clock with %i ms epoch offset",
  (offset) => {
    const epoch = 1_700_000_000_000;
    let wallMillis: number;
    let monotonicMillis: number;
    let exporter: InMemorySpanExporter;
    let provider: NodeTracerProvider;
    let plugin: InvocationOtelPlugin;
    let factory: ReturnType<typeof createInvocationOtelPluginFactory>;
    let timeOriginDescriptor: PropertyDescriptor | undefined;
    let nowDescriptor: PropertyDescriptor | undefined;

    const advance = (millis: number) => {
      wallMillis += millis;
      monotonicMillis += millis;
    };
    const find = (name: string) =>
      exporter.getFinishedSpans().find((span) => span.name === name)!;

    beforeEach(() => {
      // Neither the tracer nor SpanImpl is mocked; only their clock inputs are.
      wallMillis = epoch;
      monotonicMillis = 100;
      jest.spyOn(Date, "now").mockImplementation(() => Math.floor(wallMillis));
      timeOriginDescriptor = Object.getOwnPropertyDescriptor(
        otperformance,
        "timeOrigin",
      );
      nowDescriptor = Object.getOwnPropertyDescriptor(otperformance, "now");
      Object.defineProperty(otperformance, "timeOrigin", {
        configurable: true,
        value: epoch - monotonicMillis + offset,
      });
      Object.defineProperty(otperformance, "now", {
        configurable: true,
        value: () => monotonicMillis,
      });
      exporter = new InMemorySpanExporter();
      provider = new NodeTracerProvider({
        spanProcessors: [
          new SimpleSpanProcessor(exporter),
          {
            onStart(span) {
              // The synthetic anchor now materializes at invocation start;
              // Workflow still materializes after cleanup captures its end.
              // Advance both to exercise initialization time and late events.
              if (
                span.name === "Workflow" ||
                span.name === "DurableExecutionRoot"
              ) {
                advance(1);
              }
            },
            onEnd: () => undefined,
            forceFlush: async () => undefined,
            shutdown: async () => undefined,
          },
        ],
      });
      provider.register();
      factory = createInvocationOtelPluginFactory({
        contextExtractor: () => undefined,
      });
    });

    afterEach(async () => {
      jest.restoreAllMocks();
      for (const [key, descriptor] of [
        ["timeOrigin", timeOriginDescriptor],
        ["now", nowDescriptor],
      ] as const) {
        if (descriptor) Object.defineProperty(otperformance, key, descriptor);
        else Reflect.deleteProperty(otperformance, key);
      }
      await provider.shutdown();
      trace.disable();
      context.disable();
      propagation.disable();
    });

    it.each([
      { stalls: [0], side: "after", reads: 1, residual: 0 },
      { stalls: [20, 0], side: "after", reads: 2, residual: 0 },
      { stalls: [20, 10, 0], side: "after", reads: 3, residual: 0 },
      { stalls: [20, 0], side: "before", reads: 2, residual: 0 },
      { stalls: [40, 10, 30], side: "after", reads: 3, residual: 5 },
      { stalls: [40, 10, 30], side: "before", reads: 3, residual: -5 },
    ])(
      "bounds clock sampling with stalls $stalls ms $side the wall read",
      async ({ stalls, side, reads, residual }) => {
        let sampling = true;
        let wallReads = 0;
        let monotonicReads = 0;
        let sampledWallReads = 0;
        let sampledMonotonicReads = 0;
        jest.spyOn(Date, "now").mockImplementation(() => {
          const stall = sampling ? (stalls[wallReads++] ?? 100) : 0;
          if (side === "before") advance(stall);
          const value = Math.floor(wallMillis);
          if (side === "after") advance(stall);
          return value;
        });
        Object.defineProperty(otperformance, "now", {
          configurable: true,
          value: () => {
            if (sampling) monotonicReads++;
            return monotonicMillis;
          },
        });
        factory = createInvocationOtelPluginFactory({
          contextExtractor: () => {
            sampling = false;
            sampledWallReads = wallReads;
            sampledMonotonicReads = monotonicReads;
            return undefined;
          },
        });
        const info: InvocationInfo = {
          executionArn:
            "arn:aws:lambda:us-east-1:123456789012:durable-execution:fn:1:clock-sampling",
          executionStartTimestamp: new Date(epoch - 120_000),
          requestId: "sampling",
          isFirstInvocation: true,
          executionInput: {},
          operations: {},
          updatedOperations: {},
        };
        const operation: OperationInfo = {
          id: "sampled-step",
          type: "STEP",
          name: "sampled-step",
          isReplay: false,
        };
        const attempt: AttemptInfo = { ...operation, attempt: 1 };
        const userTracer = trace.getTracer("sampling-user");
        plugin = factory.createPlugin(info);
        await plugin.onInvocationStart(info);
        await plugin.wrapInvocation(info, async () => {
          const handlerSpan = userTracer.startSpan("user-handler");
          advance(2);
          handlerSpan.end();
          await plugin.onOperationStart(operation);
          await plugin.onOperationAttemptStart(attempt);
          await plugin.wrapOperationAttemptFn(attempt, async () => {
            const userSpan = userTracer.startSpan("user-later-attempt");
            advance(2);
            userSpan.end();
          });
          await plugin.onOperationAttemptEnd({
            ...attempt,
            outcome: "SUCCEEDED",
          });
          await plugin.onOperationEnd({ ...operation, status: "SUCCEEDED" });
          return { Status: InvocationStatus.SUCCEEDED };
        });
        await plugin.onInvocationEnd({ ...info, status: "SUCCEEDED" });
        const invocation = find("Invocation");
        const step = find("sampled-step");
        const sdkAttempt = find("sampled-step attempt 1");
        const user = find("user-later-attempt");
        // A stalled anchor otherwise contaminates even later, unstalled spans.
        // When every bounded sample stalls, retain the smallest window: its
        // midpoint has a 5 ms residual here, not the first/last window's 20/15.
        expect(
          nanoseconds(user.endTime) - nanoseconds(sdkAttempt.endTime),
        ).toBe(BigInt(residual) * 1_000_000n);
        if (residual === 0) {
          expectChildOf(find("user-handler"), invocation, 1_000_000n);
          expectChildOf(user, sdkAttempt, 1_000_000n);
        }
        expectChildOf(sdkAttempt, step);
        expectChildOf(step, invocation);
        expectAnchoredTo(invocation, find("DurableExecutionRoot"));
        expect(nanoseconds(find("DurableExecutionRoot").startTime)).toBe(
          BigInt(epoch - 120_000) * 1_000_000n,
        );
        // Four ms of user work plus one ms during early anchor creation.
        expect(nanoseconds(invocation.duration)).toBe(5_000_000n);
        // No unbounded retry if every attempt is interrupted. A stall can
        // delay any individual read; this bounds reads, not scheduler latency.
        expect(sampledWallReads).toBe(reads);
        expect(sampledMonotonicReads).toBe(reads * 2);
      },
    );

    it("anchors an omitted execution start before a millisecond rollover", async () => {
      jest.useFakeTimers({ now: epoch, doNotFake: ["performance"] });
      try {
        factory = createInvocationOtelPluginFactory({
          contextExtractor: () => {
            // Date advances by one integer millisecond while only a fraction
            // elapses since the invocation's wall/monotonic clock was sampled.
            monotonicMillis += 0.25;
            jest.setSystemTime(epoch + 1);
            return undefined;
          },
        });
        const info: InvocationInfo = {
          executionArn:
            "arn:aws:lambda:us-east-1:123456789012:durable-execution:fn:1:clock-rollover",
          requestId: "rollover",
          isFirstInvocation: true,
          executionInput: {},
          operations: {},
          updatedOperations: {},
        };
        plugin = factory.createPlugin(info);
        await plugin.onInvocationStart(info);
        monotonicMillis += 1;
        await plugin.onInvocationEnd({
          ...info,
          status: InvocationStatus.SUCCEEDED,
        });
        const spans = exporter.getFinishedSpans();
        const invocation = spans.find((span) => span.name === "Invocation")!;
        const workflow = spans.find((span) => span.name === "Workflow")!;
        const root = spans.find(
          (span) => span.name === "DurableExecutionRoot",
        )!;
        expect(nanoseconds(workflow.startTime)).toBeLessThanOrEqual(
          nanoseconds(invocation.startTime),
        );
        expectChildOf(invocation, root);
        expectChildOf(workflow, root);
        expect(nanoseconds(workflow.endTime)).toBeGreaterThanOrEqual(
          nanoseconds(workflow.startTime),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it.each(
      [-60_000, 0, 60_000].flatMap((wallStep) =>
        [0, 0.75].flatMap((wallFraction) =>
          [false, true].map((freshFactory) => ({
            wallStep,
            wallFraction,
            freshFactory,
          })),
        ),
      ),
    )(
      "preserves absolute timestamps through a $wallStep ms wall step at $wallFraction ms wall fraction (fresh factory on resume: $freshFactory)",
      async ({ wallStep, wallFraction, freshFactory }) => {
        // Exercise both rounding directions while SDK starts and ends share
        // one precision. Default user spans retain only the existing 1 ms
        // allowance; all SDK relationships and ordering remain exact.
        wallMillis = epoch + wallFraction;
        const starts = jest.spyOn(
          provider.getTracer("aws-durable-execution-sdk-js"),
          "startSpan",
        );
        const historicalStart = new Date(epoch - 120_000);
        const info: InvocationInfo = {
          executionArn:
            "arn:aws:lambda:us-east-1:123456789012:function:clock:$LATEST/durable-execution/wall-step",
          requestId: "first",
          isFirstInvocation: true,
          executionInput: {},
          operations: {},
          updatedOperations: {},
          executionStartTimestamp: historicalStart,
        };
        const childInfo: OperationInfo = {
          id: "context",
          name: "context",
          type: "CONTEXT",
          isReplay: false,
        };
        const operation: OperationInfo = {
          id: "step",
          name: "step",
          type: "STEP",
          parentId: childInfo.id,
          isReplay: false,
        };
        const attemptInfo: AttemptInfo = { ...operation, attempt: 1 };
        const userTracer = trace.getTracer("wall-step-user");
        plugin = factory.createPlugin(info);
        await plugin.onInvocationStart(info);
        advance(0.5);
        await plugin.onOperationStart(childInfo);
        await plugin.onOperationStart(operation);
        await plugin.onOperationAttemptStart(attemptInfo);
        await plugin.wrapOperationAttemptFn(attemptInfo, async () => {
          const user = userTracer.startSpan("user-before-wall-step");
          advance(10.25);
          wallMillis += wallStep;
          advance(40);
          user.end();
        });
        await plugin.onOperationAttemptEnd({
          ...attemptInfo,
          outcome: "FAILED",
          error: new Error("retry"),
          endTimestamp: new Date(wallMillis),
        });

        // New SDK operations keep this invocation's epoch even after the step.
        const afterStep: OperationInfo = {
          ...operation,
          id: "after-step",
          name: "after-step",
        };
        await plugin.onOperationStart(afterStep);
        advance(3.25);
        await plugin.onOperationEnd({
          ...afterStep,
          status: "FAILED",
          error: new Error("operation-failure"),
        });
        await plugin.onOperationEnd({
          id: "continuation",
          parentId: childInfo.id,
          name: "continuation",
          type: "WAIT",
          isReplay: false,
          status: "FAILED",
          error: new Error("continuation-failure"),
        });
        await plugin.onInvocationEnd({ ...info, status: "PENDING" });

        const attempt = find("step attempt 1");
        const invocation = find("Invocation");
        const user = find("user-before-wall-step");
        expect(nanoseconds(user.duration)).toBe(50_250_000n);
        expectChildOf(user, attempt, 1_000_000n);
        // SDK siblings must remain strictly ordered even inside one wall-ms
        // tick. User-clock rounding tolerance must not leak into SDK ordering.
        expect(
          nanoseconds(find("after-step").startTime),
        ).toBeGreaterThanOrEqual(nanoseconds(attempt.endTime));
        expect(nanoseconds(attempt.duration)).toBe(50_250_000n);
        // Include the processor's 1 ms at early anchor creation.
        expect(nanoseconds(invocation.duration)).toBe(55_000_000n);
        expect(nanoseconds(find("after-step").startTime)).toBe(
          BigInt(epoch) * 1_000_000n + 51_750_000n,
        );
        expect(nanoseconds(find("after-step").duration)).toBe(3_250_000n);
        // Every recordException path must export a real in-bounds event,
        // including the immediately-ended continuation after the wall step.
        for (const span of [
          attempt,
          find("after-step"),
          find("continuation"),
        ]) {
          expect(span.events).toHaveLength(1);
          expect(span.events[0].name).toBe("exception");
          expect(nanoseconds(span.events[0].time)).toBeGreaterThanOrEqual(
            nanoseconds(span.startTime),
          );
          expect(nanoseconds(span.events[0].time)).toBeLessThanOrEqual(
            nanoseconds(span.endTime),
          );
        }
        for (const name of ["context", "step"]) {
          const span = find(name);
          expect(span.endTime).toEqual(invocation.endTime);
          expectChildOf(
            span,
            name === "context" ? invocation : find("context"),
          );
          expect(span.spanContext().spanId).toBe(
            deriveSpanIdFromOperationId(name, info.executionArn),
          );
        }
        expect(find("Workflow")).toBeUndefined();
        expectAnchoredTo(invocation, find("DurableExecutionRoot"));

        advance(1_000);
        const resumedAt = Date.now();
        const resumed = {
          ...info,
          requestId: "resumed",
          isFirstInvocation: false,
        };
        if (freshFactory) {
          // Another execution environment creates its own factory. Every
          // invocation receives a fresh instance under the SDK 3.x contract.
          factory = createInvocationOtelPluginFactory({
            contextExtractor: () => undefined,
          });
        }
        plugin = factory.createPlugin(resumed);
        await plugin.onInvocationStart(resumed);
        await plugin.onOperationStart({ ...childInfo, isReplay: true });
        await plugin.onOperationStart({ ...operation, isReplay: true });
        const resumedAttempt = { ...attemptInfo, attempt: 2, isReplay: true };
        await plugin.onOperationAttemptStart(resumedAttempt);
        await plugin.wrapOperationAttemptFn(resumedAttempt, async () => {
          const user = userTracer.startSpan("user-after-resume");
          advance(25.5);
          user.end();
        });
        await plugin.onOperationAttemptEnd({
          ...resumedAttempt,
          outcome: "SUCCEEDED",
        });
        // Leave the resumed operations open to exercise terminal cleanup too.
        const terminalStatus = wallFraction === 0 ? "FAILED" : "SUCCEEDED";
        await plugin.onInvocationEnd({
          ...resumed,
          status: terminalStatus,
          ...(terminalStatus === "FAILED"
            ? { executionError: new Error("execution-failure") }
            : {}),
        });

        const invocations = exporter
          .getFinishedSpans()
          .filter((span) => span.name === "Invocation");
        expect(invocations).toHaveLength(2);
        const second = invocations[1];
        expect(nanoseconds(second.startTime)).toBe(
          BigInt(resumedAt) * 1_000_000n,
        );
        expect(nanoseconds(second.duration)).toBe(26_500_000n);
        expect(second.status.code).toBe(
          terminalStatus === "FAILED"
            ? SpanStatusCode.ERROR
            : SpanStatusCode.OK,
        );
        expect(find("Workflow").status.code).toBe(second.status.code);
        expectChildOf(
          find("user-after-resume"),
          find("step attempt 2"),
          1_000_000n,
        );
        const resumedContext = exporter
          .getFinishedSpans()
          .filter((span) => span.name === "context")
          .at(-1)!;
        const resumedStep = exporter
          .getFinishedSpans()
          .filter((span) => span.name === "step")
          .at(-1)!;
        expectChildOf(resumedContext, second);
        expectChildOf(resumedStep, resumedContext);
        expectChildOf(find("step attempt 2"), resumedStep);
        for (const name of ["context", "step", "Workflow"]) {
          const span = exporter
            .getFinishedSpans()
            .filter((span) => span.name === name)
            .at(-1)!;
          expect(span.endTime).toEqual(second.endTime);
        }
        for (const name of ["Workflow", "DurableExecutionRoot"]) {
          const spans = exporter
            .getFinishedSpans()
            .filter((span) => span.name === name);
          expect(spans).toHaveLength(name === "Workflow" ? 1 : 2);
          for (const span of spans) {
            expect(nanoseconds(span.startTime)).toBe(
              BigInt(historicalStart.getTime()) * 1_000_000n,
            );
            if (name === "DurableExecutionRoot") {
              expectAnchoredTo(second, span);
              expect(span.spanContext()).toEqual(spans[0].spanContext());
            }
          }
        }
        expect(find("Workflow").spanContext().spanId).toBe(
          deriveWorkflowSpanId(info.executionArn),
        );
        expectAnchoredTo(find("Workflow"), find("DurableExecutionRoot"));
        expectAnchoredTo(second, find("DurableExecutionRoot"));
        // Both invocations retain the anchor identity even across wall steps
        // and when another execution environment creates the resume's factory.
        expectAnchoredTo(invocation, find("DurableExecutionRoot"));
        for (const [index, [, options]] of starts.mock.calls.entries()) {
          const span = starts.mock.results[index].value;
          const exported = exporter
            .getFinishedSpans()
            .find(
              (finished) =>
                finished.spanContext().spanId === span.spanContext().spanId,
            )!;
          // The public TimeInput converter and the real tracer must agree on
          // the absolute timestamp. They use different numeric heuristics:
          // core compares to timeOrigin; SpanImpl compares to performance.now().
          // A backward wall step must not make one interpretation add an epoch.
          expect(timeInputToHrTime(options!.startTime!)).toEqual(
            exported.startTime,
          );
        }
        for (const span of exporter.getFinishedSpans()) {
          for (const event of span.events) {
            expect(nanoseconds(event.time)).toBeGreaterThanOrEqual(
              nanoseconds(span.startTime),
            );
            expect(nanoseconds(event.time)).toBeLessThanOrEqual(
              nanoseconds(span.endTime),
            );
          }
        }
      },
    );
  },
);
