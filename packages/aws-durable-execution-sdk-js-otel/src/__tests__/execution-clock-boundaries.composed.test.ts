import type {
  AttemptInfo,
  InvocationInfo,
  OperationInfo,
} from "@aws/durable-execution-sdk-js";
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

const nanos = (t: HrTime): bigint =>
  BigInt(t[0]) * 1_000_000_000n + BigInt(t[1]);
const epoch = 1_700_000_000_000;
const executionStart = new Date(epoch - 120_000);

function inside(child: ReadableSpan, invocation: ReadableSpan): void {
  expect(
    child.links.some(
      (link) => link.context.spanId === invocation.spanContext().spanId,
    ),
  ).toBe(true);
  expect(child.spanContext().traceId).toBe(invocation.spanContext().traceId);
  expect(nanos(child.startTime)).toBeGreaterThanOrEqual(
    nanos(invocation.startTime),
  );
  expect(nanos(child.endTime)).toBeLessThanOrEqual(nanos(invocation.endTime));
}

describe.each(["global", "factory"] as const)(
  "execution clock with %s provider",
  (mode) => {
    let wall: number;
    let monotonic: number;
    let exporter: InMemorySpanExporter;
    let provider: NodeTracerProvider;
    let plugin: ExecutionOtelPlugin;
    let descriptors: (PropertyDescriptor | undefined)[];
    const advance = (ms: number) => {
      wall += ms;
      monotonic += ms;
    };
    const info = (first: boolean): InvocationInfo => ({
      executionArn:
        "arn:aws:lambda:us-east-1:123456789012:function:clock:$LATEST/durable-execution/execution-clock",
      executionStartTimestamp: executionStart,
      requestId: first ? "first" : "resumed",
      isFirstInvocation: first,
      executionInput: {},
      operations: {},
      updatedOperations: {},
    });
    beforeEach(() => {
      wall = epoch;
      monotonic = 100;
      descriptors = ["now", "timeOrigin"].map((key) =>
        Object.getOwnPropertyDescriptor(otperformance, key),
      );
      jest.spyOn(Date, "now").mockImplementation(() => Math.floor(wall));
      Object.defineProperty(otperformance, "now", {
        configurable: true,
        value: () => monotonic,
      });
      exporter = new InMemorySpanExporter();
      const register = (idGenerator?: IdGenerator) => {
        provider = new NodeTracerProvider({
          idGenerator,
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        });
        provider.register();
        return provider;
      };
      if (mode === "global") register();
      plugin = new ExecutionOtelPlugin({
        contextExtractor: () => undefined,
        ...(mode === "factory"
          ? {
              tracerProviderFactory: (create: () => IdGenerator) =>
                register(create()),
            }
          : {}),
      });
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      ["now", "timeOrigin"].forEach((key, i) => {
        if (descriptors[i])
          Object.defineProperty(otperformance, key, descriptors[i]!);
        else Reflect.deleteProperty(otperformance, key);
      });
      await provider.shutdown();
      trace.disable();
      context.disable();
      propagation.disable();
    });

    it.each([false, true])(
      "keeps failure events within operation and attempt intervals (backend end=%s)",
      async (providedEnd) => {
        wall = epoch + 0.75;
        const invocationInfo = info(true);
        await plugin.onInvocationStart(invocationInfo);
        const operation: OperationInfo = {
          id: "failed",
          name: "failed",
          type: "STEP",
          isReplay: false,
          startTimestamp: new Date(epoch),
        };
        const attempt: AttemptInfo = { ...operation, attempt: 1 };
        await plugin.onOperationStart(operation);
        await plugin.onOperationAttemptStart(attempt);
        advance(0.725);
        const endTimestamp = providedEnd
          ? new Date(Math.floor(wall))
          : undefined;
        // Failure metadata can arrive after its backend completion. When it is
        // absent, Date's whole millisecond must not race the shared live clock.
        if (providedEnd) advance(5);
        const error = new Error("failed operation");
        await plugin.onOperationAttemptEnd({
          ...attempt,
          outcome: "FAILED",
          endTimestamp,
          error,
        });
        await plugin.onOperationEnd({
          ...operation,
          status: "FAILED",
          endTimestamp,
          error,
        });
        await plugin.onInvocationEnd({ ...invocationInfo, status: "FAILED" });
        const spans = exporter
          .getFinishedSpans()
          .filter(
            (span) => span.attributes["durable.operation.id"] === operation.id,
          );
        expect(spans).toHaveLength(2);
        for (const span of spans) {
          expect(span.events).toHaveLength(1);
          expect(nanos(span.events[0].time)).toBeGreaterThanOrEqual(
            nanos(span.startTime),
          );
          expect(span.events[0].time).toEqual(span.endTime);
          expect(span.events[0].attributes?.["exception.message"]).toBe(
            error.message,
          );
        }
      },
    );

    it.each([-10, 10])(
      "contains authoritative attempt dates across resume with %i ms origin offset",
      async (offset) => {
        Object.defineProperty(otperformance, "timeOrigin", {
          configurable: true,
          value: epoch - monotonic + offset,
        });
        for (const first of [true, false]) {
          wall = epoch + (first ? 0 : 1000) + 0.75;
          monotonic = first ? 100 : 1100;
          const invocationInfo = info(first);
          await plugin.onInvocationStart(invocationInfo);
          if (!first) {
            // This logical wait began before this invocation. Its historical start
            // must not be rewritten or treated as the resumed invocation's start.
            await plugin.onOperationEnd({
              id: "wait",
              name: "historic-wait",
              type: "WAIT",
              isReplay: false,
              startTimestamp: new Date(epoch - 10_000),
              endTimestamp: new Date(epoch + 500),
              status: "SUCCEEDED",
            });
          }
          const operation: OperationInfo = {
            id: first ? "before" : "after",
            name: first ? "before" : "after",
            type: "STEP",
            isReplay: false,
            startTimestamp: new Date(Math.floor(wall)),
          };
          const attempt: AttemptInfo = { ...operation, attempt: 1 };
          await plugin.onOperationStart(operation);
          await plugin.onOperationAttemptStart(attempt);
          await plugin.wrapOperationAttemptFn(attempt, async () => {
            // Real user tracer, no explicit parent or timestamps.
            const user = trace
              .getTracer("execution-clock-user")
              .startSpan(first ? "user-before" : "user-after");
            advance(0.725);
            user.end();
          });
          const logicalEnd = new Date(Math.floor(wall));
          await plugin.onOperationAttemptEnd({
            ...attempt,
            endTimestamp: logicalEnd,
            outcome: "SUCCEEDED",
          });
          await plugin.onOperationEnd({
            ...operation,
            endTimestamp: logicalEnd,
            status: "SUCCEEDED",
          });
          await plugin.onInvocationEnd({
            ...invocationInfo,
            status: first ? "PENDING" : "SUCCEEDED",
          });
          const spans = exporter.getFinishedSpans();
          const invocation = spans
            .filter((s) => s.name === "Invocation")
            .at(-1)!;
          const exportedAttempt = spans.find(
            (s) => s.name === `${operation.name} attempt 1`,
          )!;
          const exportedOperation = spans.find(
            (s) => s.name === operation.name,
          )!;
          inside(exportedAttempt, invocation);
          inside(exportedOperation, invocation);
          expect(nanos(exportedAttempt.startTime)).toBe(
            BigInt(attempt.startTimestamp!.getTime()) * 1_000_000n,
          );
          expect(nanos(exportedAttempt.endTime)).toBe(
            BigInt(logicalEnd.getTime()) * 1_000_000n,
          );
          expect(exportedOperation.endTime).toEqual(exportedAttempt.endTime);
          // Extend only to an actual observed timestamp, not a fixed tolerance.
          expect(invocation.endTime).toEqual(exportedAttempt.endTime);
          expect(nanos(invocation.startTime)).toBe(
            BigInt(Math.floor(epoch + (first ? 0 : 1000))) * 1_000_000n,
          );
          const user = spans.find(
            (s) => s.name === (first ? "user-before" : "user-after"),
          )!;
          expect(user.parentSpanContext?.spanId).toBe(
            exportedAttempt.spanContext().spanId,
          );
          expect(nanos(user.endTime)).toBeLessThanOrEqual(
            nanos(exportedAttempt.endTime),
          );
        }
        const spans = exporter.getFinishedSpans();
        const last = spans.filter((s) => s.name === "Invocation").at(-1)!;
        for (const name of ["Workflow", "DurableExecutionRoot"]) {
          const span = spans.find((s) => s.name === name)!;
          expect(nanos(span.startTime)).toBe(
            BigInt(executionStart.getTime()) * 1_000_000n,
          );
          expect(span.endTime).toEqual(last.endTime);
        }
        expect(
          nanos(spans.find((s) => s.name === "historic-wait")!.startTime),
        ).toBe(BigInt(epoch - 10_000) * 1_000_000n);
      },
    );

    it("uses monotonic elapsed time without padding when no later backend boundary is observed", async () => {
      Object.defineProperty(otperformance, "timeOrigin", {
        configurable: true,
        value: epoch - monotonic + 10,
      });
      await plugin.onInvocationStart(info(true));
      const attempt: AttemptInfo = {
        id: "open",
        name: "open",
        type: "STEP",
        isReplay: false,
        attempt: 1,
        startTimestamp: new Date(epoch),
      };
      await plugin.onOperationAttemptStart(attempt);
      advance(10);
      wall -= 60_000;
      advance(5);
      await plugin.onInvocationEnd({ ...info(true), status: "PENDING" });
      const spans = exporter.getFinishedSpans();
      const invocation = spans.find((s) => s.name === "Invocation")!;
      const open = spans.find((s) => s.name === "open attempt 1")!;
      expect(nanos(invocation.duration)).toBe(15_000_000n);
      expect(nanos(open.duration)).toBe(15_000_000n);
      inside(open, invocation);
    });
  },
);
