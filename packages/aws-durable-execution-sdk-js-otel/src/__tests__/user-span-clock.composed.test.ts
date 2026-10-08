import type {
  AttemptInfo,
  InvocationInfo,
  OperationInfo,
} from "@aws/durable-execution-sdk-js";
import { InvocationStatus } from "@aws/durable-execution-sdk-js";
import { context, propagation, trace } from "@opentelemetry/api";
import type { HrTime } from "@opentelemetry/api";
import { otperformance } from "@opentelemetry/core";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import type { IdGenerator, ReadableSpan } from "@opentelemetry/sdk-trace-node";
import { ExecutionOtelPlugin } from "../execution-plugin";
import { InvocationOtelPlugin } from "../invocation-plugin";

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

describe.each([
  ["invocation", InvocationOtelPlugin],
  ["execution", ExecutionOtelPlugin],
] as const)("%s view user span clocks", (view, Plugin) => {
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
      const plugin = new Plugin({
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
              // a live start, exercising InvocationOtelPlugin's continuation.
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
