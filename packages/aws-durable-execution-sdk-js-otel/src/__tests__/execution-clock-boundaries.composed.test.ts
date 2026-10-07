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

    it.each([-60_000, 60_000])(
      "keeps a virtual context on the invocation clock after a %i ms wall step",
      async (wallStep) => {
        const actualDate = Date;
        // Control Date construction as well as Date.now, without replacing the
        // asynchronous primitives used by provider flushing.
        globalThis.Date = new Proxy(actualDate, {
          construct(target, args) {
            return Reflect.construct(
              target,
              args.length ? args : [Math.floor(wall)],
            );
          },
        });
        try {
          const invocationInfo = info(true);
          await plugin.onInvocationStart(invocationInfo);
          wall += wallStep;
          const operation: OperationInfo = {
            id: "virtual",
            name: "virtual",
            type: "CONTEXT",
            subType: "RUN_IN_CHILD_CONTEXT",
            isReplay: true,
          };
          // Virtual child contexts supply no backend timestamps on either hook.
          await plugin.onOperationStart(operation);
          advance(5);
          await plugin.onOperationEnd({ ...operation, status: "SUCCEEDED" });
          await plugin.onInvocationEnd({
            ...invocationInfo,
            status: "SUCCEEDED",
          });
          const spans = exporter.getFinishedSpans();
          const child = spans.find((span) => span.name === "virtual")!;
          const invocation = spans.find((span) => span.name === "Invocation")!;
          expect(nanos(child.endTime) - nanos(child.startTime)).toBe(
            5_000_000n,
          );
          inside(child, invocation);
        } finally {
          globalThis.Date = actualDate;
        }
      },
    );

    it("uses an observed attempt start when its operation fallback is later", async () => {
      wall = epoch + 0.75;
      const invocationInfo = info(true);
      await plugin.onInvocationStart(invocationInfo);
      advance(0.125);
      const operation: OperationInfo = {
        id: "coarse-attempt",
        name: "coarse-attempt",
        type: "STEP",
        isReplay: false,
      };
      await plugin.onOperationStart(operation);
      const attempt: AttemptInfo = {
        ...operation,
        attempt: 1,
        startTimestamp: new Date(Math.floor(wall)),
      };
      await plugin.onOperationAttemptStart(attempt);
      advance(0.125);
      const endTimestamp = new Date(Math.floor(wall));
      await plugin.onOperationAttemptEnd({
        ...attempt,
        outcome: "SUCCEEDED",
        endTimestamp,
      });
      await plugin.onOperationEnd({
        ...operation,
        status: "SUCCEEDED",
        endTimestamp,
      });
      await plugin.onInvocationEnd({ ...invocationInfo, status: "SUCCEEDED" });
      const spans = exporter.getFinishedSpans();
      const parent = spans.find((span) => span.name === "coarse-attempt")!;
      const child = spans.find(
        (span) => span.name === "coarse-attempt attempt 1",
      )!;
      expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
      expect(nanos(child.startTime)).toBeGreaterThanOrEqual(
        nanos(parent.startTime),
      );
      expect(nanos(child.endTime)).toBeLessThanOrEqual(nanos(parent.endTime));
      expect(parent.startTime).toEqual(child.startTime);
    });

    it.each([0.051, 0.275, 0.777])(
      "logical precision keeps a resumed wait before the next checkpoint Date (%f ms)",
      async (elapsed) => {
        wall = epoch + 0.125;
        await plugin.onInvocationStart(info(false));
        advance(elapsed);
        const waitStart = new Date(epoch - 1000);
        await plugin.onOperationEnd({
          id: "wait",
          name: "wait",
          type: "WAIT",
          isReplay: false,
          startTimestamp: waitStart,
          status: "SUCCEEDED",
        });
        const stepStart = new Date(Math.floor(wall));
        const step: OperationInfo = {
          id: "next",
          name: "next",
          type: "STEP",
          isReplay: false,
          startTimestamp: stepStart,
        };
        const attempt: AttemptInfo = { ...step, attempt: 1 };
        const starts = jest.spyOn(
          provider.getTracer("aws-durable-execution-sdk-js"),
          "startSpan",
        );
        await plugin.onOperationStart(step);
        await plugin.onOperationAttemptStart(attempt);
        await plugin.wrapOperationAttemptFn(attempt, async () => {
          const user = trace
            .getTracer("logical-precision-user")
            .startSpan("ordinary-user");
          advance(2);
          user.end();
        });
        const stepEnd = new Date(Math.floor(wall));
        await plugin.onOperationAttemptEnd({
          ...attempt,
          outcome: "SUCCEEDED",
          endTimestamp: stepEnd,
        });
        await plugin.onOperationEnd({
          ...step,
          status: "SUCCEEDED",
          endTimestamp: stepEnd,
        });
        await plugin.onInvocationEnd({ ...info(false), status: "SUCCEEDED" });
        const spans = exporter.getFinishedSpans();
        const wait = spans.find((s) => s.name === "wait")!,
          next = spans.find((s) => s.name === "next")!;
        expect(nanos(wait.endTime)).toBeLessThanOrEqual(nanos(next.startTime));
        expect(wait.endTime[1] % 1_000_000).toBe(0);
        expect(nanos(wait.startTime)).toBe(
          BigInt(waitStart.getTime()) * 1_000_000n,
        );
        expect(
          starts.mock.calls.find(([name]) => name === "next")![1]!.startTime,
        ).toBe(stepStart);
        expect(nanos(next.endTime)).toBe(
          BigInt(stepEnd.getTime()) * 1_000_000n,
        );
        inside(next, spans.find((s) => s.name === "Invocation")!);
        const user = spans.find((s) => s.name === "ordinary-user")!,
          parent = spans.find((s) => s.name === "next attempt 1")!;
        expect(user.parentSpanContext?.spanId).toBe(
          parent.spanContext().spanId,
        );
      },
    );

    it("logical precision uses whole milliseconds for all missing operation and attempt boundaries", async () => {
      await plugin.onInvocationStart(info(true));
      advance(0.051);
      const operation: OperationInfo = {
        id: "local",
        name: "local",
        type: "STEP",
        isReplay: false,
      };
      const attempt: AttemptInfo = { ...operation, attempt: 1 };
      await plugin.onOperationStart(operation);
      await plugin.onOperationAttemptStart(attempt);
      advance(0.726);
      const error = new Error("logical precision");
      await plugin.onOperationAttemptEnd({
        ...attempt,
        outcome: "FAILED",
        error,
      });
      await plugin.onOperationEnd({ ...operation, status: "FAILED", error });
      await plugin.onOperationAttemptStart({
        id: "cleanup",
        name: "cleanup",
        type: "STEP",
        isReplay: false,
        attempt: 1,
      });
      await plugin.onInvocationEnd({ ...info(true), status: "FAILED" });
      const spans = exporter.getFinishedSpans();
      for (const name of ["local", "local attempt 1"]) {
        const span = spans.find((s) => s.name === name)!;
        expect(span.startTime[1] % 1_000_000).toBe(0);
        expect(span.endTime[1] % 1_000_000).toBe(0);
        expect(span.events[0].time).toEqual(span.endTime);
        expect(nanos(span.endTime)).toBeGreaterThanOrEqual(
          nanos(span.startTime),
        );
      }
      const invocation = spans.find((s) => s.name === "Invocation")!;
      const cleanup = spans.find((s) => s.name === "cleanup attempt 1")!;
      expect(cleanup.startTime[1] % 1_000_000).toBe(0);
      expect(cleanup.endTime[1] % 1_000_000).toBe(0);
      inside(cleanup, invocation);
      expect(nanos(invocation.duration)).toBeGreaterThan(0n);
      expect(invocation.endTime[1] % 1_000_000).not.toBe(0);
    });

    it("logical precision retains the wall tick phase around ordinary user spans", async () => {
      wall = epoch + 0.75;
      await plugin.onInvocationStart(info(true));
      advance(0.375);
      const operation: OperationInfo = {
        id: "phase",
        name: "phase",
        type: "CONTEXT",
        isReplay: false,
      };
      await plugin.onOperationStart(operation);
      await plugin.wrapChildContextFn(operation, async () => {
        const user = trace
          .getTracer("logical-phase-user")
          .startSpan("user-phase");
        advance(0.25);
        user.end();
      });
      await plugin.onOperationEnd({ ...operation, status: "SUCCEEDED" });
      await plugin.onInvocationEnd({ ...info(true), status: "SUCCEEDED" });
      const spans = exporter.getFinishedSpans();
      const parent = spans.find((s) => s.name === "phase")!,
        user = spans.find((s) => s.name === "user-phase")!;
      expect(user.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
      expect(nanos(user.endTime) - nanos(parent.endTime)).toBeLessThanOrEqual(
        1_000_000n,
      );
      expect(parent.startTime).toEqual(user.startTime);
      expect(parent.endTime[1] % 1_000_000).toBe(0);
      inside(parent, spans.find((s) => s.name === "Invocation")!);
    });

    it("logical precision never ends an active context before an observed child checkpoint", async () => {
      wall = epoch + 0.75;
      await plugin.onInvocationStart(info(true));
      const parent: OperationInfo = {
        id: "context",
        name: "context",
        type: "CONTEXT",
        isReplay: false,
      };
      await plugin.onOperationStart(parent);
      const child: OperationInfo = {
        id: "checkpointed",
        name: "checkpointed",
        parentId: parent.id,
        type: "STEP",
        isReplay: false,
        startTimestamp: new Date(epoch),
      };
      await plugin.onOperationStart(child);
      advance(0.725);
      const authoritativeEnd = new Date(Math.floor(wall));
      await plugin.onOperationEnd({
        ...child,
        status: "SUCCEEDED",
        endTimestamp: authoritativeEnd,
      });
      await plugin.onOperationEnd({ ...parent, status: "SUCCEEDED" });
      await plugin.onInvocationEnd({ ...info(true), status: "SUCCEEDED" });
      const spans = exporter.getFinishedSpans(),
        ancestor = spans.find((s) => s.name === "context")!,
        step = spans.find((s) => s.name === "checkpointed")!;
      expect(nanos(step.endTime)).toBe(
        BigInt(authoritativeEnd.getTime()) * 1_000_000n,
      );
      expect(nanos(ancestor.endTime)).toBeGreaterThanOrEqual(
        nanos(step.endTime),
      );
      expect(ancestor.endTime).toEqual(step.endTime);
      inside(ancestor, spans.find((s) => s.name === "Invocation")!);
    });

    it.each(["context", "attempt", "end-only"] as const)(
      "keeps a missing %s start near the local clock after a future backend end",
      async (kind) => {
        await plugin.onInvocationStart(info(true));
        const previous: OperationInfo = {
          id: "previous",
          name: "previous",
          type: "STEP",
          isReplay: false,
          startTimestamp: new Date(epoch),
        };
        await plugin.onOperationStart(previous);
        advance(1);
        const backendEnd = new Date(epoch + 5);
        await plugin.onOperationEnd({
          ...previous,
          status: "SUCCEEDED",
          endTimestamp: backendEnd,
        });
        const localStart = Date.now();
        const next: OperationInfo = {
          id: "after-future",
          name: "after-future",
          type:
            kind === "context"
              ? "CONTEXT"
              : kind === "attempt"
                ? "STEP"
                : "WAIT",
          isReplay: kind === "context",
        };
        const userCode = async () => {
          const user = trace
            .getTracer("future-backend-user")
            .startSpan("ordinary-user");
          advance(2);
          user.end();
        };
        if (kind !== "end-only") await plugin.onOperationStart(next);
        if (kind === "context") {
          await plugin.wrapChildContextFn(next, userCode);
        } else if (kind === "attempt") {
          const attempt: AttemptInfo = { ...next, attempt: 1 };
          await plugin.onOperationAttemptStart(attempt);
          await plugin.wrapOperationAttemptFn(attempt, userCode);
          await plugin.onOperationAttemptEnd({
            ...attempt,
            outcome: "SUCCEEDED",
          });
        }
        await plugin.onOperationEnd({ ...next, status: "SUCCEEDED" });
        await plugin.onInvocationEnd({ ...info(true), status: "SUCCEEDED" });
        const spans = exporter.getFinishedSpans();
        const previousSpan = spans.find((s) => s.name === "previous")!;
        const parent = spans.find(
          (s) =>
            s.name ===
            (kind === "attempt" ? "after-future attempt 1" : "after-future"),
        )!;
        expect(nanos(previousSpan.endTime)).toBe(
          BigInt(backendEnd.getTime()) * 1_000_000n,
        );
        // A supplied future date stays authoritative for completion, but must
        // not push an unrelated local start beyond Date's precision interval.
        expect(nanos(parent.startTime)).toBeGreaterThanOrEqual(
          BigInt(localStart) * 1_000_000n,
        );
        expect(nanos(parent.startTime)).toBeLessThanOrEqual(
          BigInt(localStart + 1) * 1_000_000n,
        );
        inside(parent, spans.find((s) => s.name === "Invocation")!);
        if (kind !== "end-only") {
          const user = spans.find((s) => s.name === "ordinary-user")!;
          expect(user.parentSpanContext?.spanId).toBe(
            parent.spanContext().spanId,
          );
          expect(nanos(user.startTime) + 1_000_000n).toBeGreaterThanOrEqual(
            nanos(parent.startTime),
          );
          expect(nanos(user.endTime) - 1_000_000n).toBeLessThanOrEqual(
            nanos(parent.endTime),
          );
        }
      },
    );

    it("keeps a coarse checkpoint before the next local start after wall rollback", async () => {
      wall = epoch + 0.75;
      await plugin.onInvocationStart(info(true));
      const previous: OperationInfo = {
        id: "before-rollback",
        name: "before-rollback",
        type: "STEP",
        isReplay: false,
        startTimestamp: new Date(epoch),
      };
      await plugin.onOperationStart(previous);
      advance(0.725);
      await plugin.onOperationEnd({
        ...previous,
        status: "SUCCEEDED",
        endTimestamp: new Date(Math.floor(wall)),
      });
      wall -= 60_000;
      const next: OperationInfo = {
        id: "after-rollback",
        name: "after-rollback",
        type: "CONTEXT",
        isReplay: true,
      };
      await plugin.onOperationStart(next);
      advance(2);
      await plugin.onOperationEnd({ ...next, status: "SUCCEEDED" });
      await plugin.onInvocationEnd({ ...info(true), status: "SUCCEEDED" });
      const spans = exporter.getFinishedSpans();
      const previousSpan = spans.find((s) => s.name === "before-rollback")!;
      const nextSpan = spans.find((s) => s.name === "after-rollback")!;
      expect(nanos(nextSpan.startTime)).toBeGreaterThanOrEqual(
        nanos(previousSpan.endTime),
      );
      inside(nextSpan, spans.find((s) => s.name === "Invocation")!);
    });

    it.each(["operation start", "attempt start", "operation end"])(
      "carries a coarse child Date into active ancestors at %s",
      async (observedAt) => {
        wall = epoch + 0.75;
        await plugin.onInvocationStart(info(true));
        advance(0.051);
        const starts = jest.spyOn(
          provider.getTracer("aws-durable-execution-sdk-js"),
          "startSpan",
        );
        const outer: OperationInfo = {
          id: "map",
          name: "map",
          type: "CONTEXT",
          isReplay: false,
        };
        const iteration: OperationInfo = {
          id: "iteration",
          name: "iteration",
          parentId: outer.id,
          type: "CONTEXT",
          isReplay: false,
        };
        const coarse = new Date(epoch);
        const step: OperationInfo = {
          id: "nested-step",
          name: "nested-step",
          parentId: iteration.id,
          type: "STEP",
          isReplay: false,
          ...(observedAt === "operation start"
            ? { startTimestamp: coarse }
            : {}),
        };
        const attempt: AttemptInfo = {
          ...step,
          attempt: 1,
          ...(observedAt === "attempt start" ? { startTimestamp: coarse } : {}),
        };
        await plugin.onOperationStart(outer);
        await plugin.onOperationStart(iteration);
        await plugin.onOperationStart(step);
        await plugin.onOperationAttemptStart(attempt);
        await plugin.wrapOperationAttemptFn(attempt, async () => {
          const user = trace
            .getTracer("ancestor-clock-user")
            .startSpan("ordinary-user-span");
          advance(2);
          user.end();
        });
        const endTimestamp = new Date(Math.floor(wall));
        await plugin.onOperationAttemptEnd({
          ...attempt,
          outcome: "SUCCEEDED",
          endTimestamp,
        });
        await plugin.onOperationEnd({
          ...step,
          status: "SUCCEEDED",
          endTimestamp,
          ...(observedAt === "operation end" ? { startTimestamp: coarse } : {}),
        });
        advance(1);
        await plugin.onOperationEnd({ ...iteration, status: "SUCCEEDED" });
        await plugin.onOperationEnd({ ...outer, status: "SUCCEEDED" });
        await plugin.onInvocationEnd({ ...info(true), status: "SUCCEEDED" });
        const spans = exporter.getFinishedSpans();
        const byName = (name: string) =>
          spans.find((span) => span.name === name)!;
        for (const [childName, parentName] of [
          ["nested-step attempt 1", "nested-step"],
          ["nested-step", "iteration"],
          ["iteration", "map"],
        ]) {
          const child = byName(childName),
            parent = byName(parentName);
          expect(child.parentSpanContext?.spanId).toBe(
            parent.spanContext().spanId,
          );
          expect(child.spanContext().traceId).toBe(
            parent.spanContext().traceId,
          );
          expect(nanos(child.startTime)).toBeGreaterThanOrEqual(
            nanos(parent.startTime),
          );
          expect(nanos(child.endTime)).toBeLessThanOrEqual(
            nanos(parent.endTime),
          );
        }
        // Preserve the observed timestamp object, not a rounded/rebuilt value.
        for (const name of ["map", "iteration", "nested-step"]) {
          expect(
            starts.mock.calls.find(([spanName]) => spanName === name)![1]!
              .startTime,
          ).toBe(coarse);
        }
        expect(coarse.getTime()).toBe(epoch);
        expect(byName("ordinary-user-span").parentSpanContext?.spanId).toBe(
          byName("nested-step attempt 1").spanContext().spanId,
        );
      },
    );

    it("preserves earlier parent dates and stops at ended parents", async () => {
      await plugin.onInvocationStart(info(true));
      const historical = new Date(epoch - 10);
      const parent: OperationInfo = {
        id: "closed",
        name: "closed",
        type: "CONTEXT",
        isReplay: false,
        startTimestamp: historical,
      };
      const starts = jest.spyOn(
        provider.getTracer("aws-durable-execution-sdk-js"),
        "startSpan",
      );
      await plugin.onOperationStart(parent);
      await plugin.onOperationStart({
        id: "child",
        name: "child",
        parentId: parent.id,
        type: "STEP",
        isReplay: false,
        startTimestamp: new Date(epoch),
      });
      await plugin.onOperationEnd({
        id: "child",
        name: "child",
        parentId: parent.id,
        type: "STEP",
        isReplay: false,
        status: "SUCCEEDED",
      });
      await plugin.onOperationEnd({ ...parent, status: "SUCCEEDED" });
      const cache = (
        plugin as unknown as { operationStarts: Map<string, unknown> }
      ).operationStarts;
      expect(cache.has(parent.id)).toBe(false);
      const closedStart = exporter
        .getFinishedSpans()
        .find((span) => span.name === "closed")!.startTime;
      await plugin.onOperationStart({
        id: "late",
        parentId: parent.id,
        type: "STEP",
        isReplay: false,
        startTimestamp: new Date(epoch - 20),
      });
      expect(cache.has(parent.id)).toBe(false);
      expect(
        exporter.getFinishedSpans().find((span) => span.name === "closed")!
          .startTime,
      ).toEqual(closedStart);
      expect(
        starts.mock.calls.find(([name]) => name === "closed")![1]!.startTime,
      ).toBe(historical);
      await plugin.onInvocationEnd({ ...info(true), status: "PENDING" });
      expect(cache.size).toBe(0);
      wall += 1000;
      monotonic += 1000;
      await plugin.onInvocationStart(info(false));
      await plugin.onOperationStart({
        id: "closed",
        name: "resumed",
        type: "CONTEXT",
        isReplay: true,
      });
      await plugin.onOperationEnd({
        id: "closed",
        name: "resumed",
        type: "CONTEXT",
        isReplay: true,
        status: "SUCCEEDED",
      });
      await plugin.onInvocationEnd({ ...info(false), status: "SUCCEEDED" });
      expect(
        nanos(
          exporter.getFinishedSpans().find((span) => span.name === "resumed")!
            .startTime,
        ),
      ).toBe(BigInt(epoch + 1000) * 1_000_000n);
    });

    it("terminates the private ancestor walk when parent IDs form a cycle", async () => {
      await plugin.onInvocationStart(info(true));
      advance(0.051);
      await plugin.onOperationStart({
        id: "a",
        parentId: "b",
        type: "CONTEXT",
        isReplay: false,
      });
      await plugin.onOperationStart({
        id: "b",
        parentId: "a",
        type: "CONTEXT",
        isReplay: false,
      });
      const cache = (
        plugin as unknown as {
          operationStarts: Map<string, { startTimestamp?: Date | HrTime }>;
        }
      ).operationStarts;
      const originalGet = cache.get.bind(cache);
      let reads = 0;
      const get = jest.spyOn(cache, "get").mockImplementation((id) => {
        if (++reads > 32)
          throw new Error("ancestor traversal failed to terminate");
        return originalGet(id);
      });
      const coarse = new Date(epoch);
      await plugin.onOperationStart({
        id: "child",
        parentId: "b",
        type: "STEP",
        isReplay: false,
        startTimestamp: coarse,
      });
      expect(reads).toBeLessThanOrEqual(16);
      get.mockRestore();
      expect(cache.get("a")!.startTimestamp).toBe(coarse);
      expect(cache.get("b")!.startTimestamp).toBe(coarse);
      await plugin.onInvocationEnd({ ...info(true), status: "PENDING" });
      expect(cache.size).toBe(0);
    });

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
