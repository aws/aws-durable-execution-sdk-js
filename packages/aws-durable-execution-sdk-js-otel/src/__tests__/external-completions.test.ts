import type { HrTime } from "@opentelemetry/api";
import type {
  InvocationInfo,
  OperationInfo,
} from "@aws/durable-execution-sdk-js";
import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { otperformance, timeInputToHrTime } from "@opentelemetry/core";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { createExecutionOtelPluginFactory } from "../execution-plugin";
import { createInvocationOtelPluginFactory } from "../invocation-plugin";
import { deriveSpanIdFromOperationId } from "../deterministic-id-generator";

const nanoseconds = (time: HrTime): bigint =>
  BigInt(time[0]) * 1_000_000_000n + BigInt(time[1]);

const invocation: InvocationInfo = {
  requestId: "request-1",
  executionArn: "arn:execution:external",
  executionInput: {},
  operations: {},
  updatedOperations: {},
  isFirstInvocation: false,
  executionStartTimestamp: new Date("2026-01-01T00:00:00Z"),
};
const start = new Date("2026-01-01T00:00:01Z");
const end = new Date("2026-01-01T00:00:02Z");
const operation: OperationInfo = {
  id: "external",
  name: "external",
  type: "CALLBACK",
  subType: "Callback",
  parentId: "parent",
  status: "SUCCEEDED",
  startTimestamp: start,
  endTimestamp: end,
  isReplay: false,
};

describe.each([
  ["execution", createExecutionOtelPluginFactory],
  ["invocation", createInvocationOtelPluginFactory],
] as const)("%s view completion notifications", (view, createFactory) => {
  let exporter: InMemorySpanExporter;
  let providers: NodeTracerProvider[];
  const createPlugin = (info: InvocationInfo = invocation) =>
    createFactory({
      contextExtractor: () => undefined,
      tracerProviderFactory(createIdGenerator) {
        const provider = new NodeTracerProvider({
          idGenerator: createIdGenerator(),
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        });
        providers.push(provider);
        return provider;
      },
    }).createPlugin(info);
  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    providers = [];
  });
  afterEach(async () => {
    await Promise.all(providers.map((provider) => provider.shutdown()));
    context.disable();
    trace.disable();
  });
  const spans = () =>
    exporter.getFinishedSpans().filter((span) => span.name === "external");

  it.each(
    ["WAIT", "INVOKE", "CHAINED_INVOKE", "CALLBACK"].flatMap((type) =>
      [false, true].map((started) => ({ type, started })),
    ),
  )(
    "flushes a $type completion during shutdown (started=$started) and deduplicates later hooks",
    async ({ type, started: operationStarted }) => {
      const current = createPlugin();
      await current.onInvocationStart(invocation);
      if (operationStarted)
        await current.onOperationStart({
          ...operation,
          type,
          status: "STARTED",
          endTimestamp: undefined,
        });
      const completed = () =>
        spans().filter(
          (span) => span.attributes["durable.operation.status"] === "SUCCEEDED",
        );
      let unblock!: () => void;
      let flushing!: () => void;
      const blocked = new Promise<void>((resolve) => {
        unblock = resolve;
      });
      const started = new Promise<void>((resolve) => {
        flushing = resolve;
      });
      const provider = providers[0];
      const originalFlush = provider.forceFlush.bind(provider);
      const flushed: number[] = [];
      let activeFlushes = 0;
      let maximumActiveFlushes = 0;
      const flush = jest
        .spyOn(provider, "forceFlush")
        .mockImplementation(async () => {
          activeFlushes++;
          maximumActiveFlushes = Math.max(maximumActiveFlushes, activeFlushes);
          flushed.push(completed().length);
          if (flushed.length === 1) {
            flushing();
            await blocked;
          }
          await originalFlush();
          activeFlushes--;
        });
      const ending = current.onInvocationEnd({
        ...invocation,
        status: "PENDING",
      });
      await started;
      const completion = { ...operation, type };
      const changed = current.onOperationChange({
        ...invocation,
        updatedOperations: { external: completion },
      });
      unblock();
      await Promise.all([ending, changed]);
      expect(completed()).toHaveLength(1);
      expect(flushed).toContain(1);
      expect(maximumActiveFlushes).toBe(1);
      await current.onOperationChange({
        ...invocation,
        updatedOperations: { external: completion },
      });
      await current.onOperationEnd(completion);
      expect(completed()).toHaveLength(1);
      flush.mockRestore();
    },
  );

  it.each(["PENDING", "SUCCEEDED"] as const)(
    "keeps enclosing spans open for completion arriving during first flush (%s)",
    async (status) => {
      let now = end.getTime() + 10000;
      const originalNow = Object.getOwnPropertyDescriptor(otperformance, "now");
      const originalOrigin = Object.getOwnPropertyDescriptor(
        otperformance,
        "timeOrigin",
      );
      const origin = now - 100;
      const wallClock = jest.spyOn(Date, "now").mockImplementation(() => now);
      Object.defineProperty(otperformance, "now", {
        configurable: true,
        value: () => now - origin,
      });
      Object.defineProperty(otperformance, "timeOrigin", {
        configurable: true,
        value: origin,
      });
      try {
        const current = createPlugin();
        await current.onInvocationStart(invocation);
        let unblock!: () => void;
        let flushing!: () => void;
        const blocked = new Promise<void>((resolve) => {
          unblock = resolve;
        });
        const started = new Promise<void>((resolve) => {
          flushing = resolve;
        });
        const originalFlush = providers[0].forceFlush.bind(providers[0]);
        let calls = 0;
        const flush = jest
          .spyOn(providers[0], "forceFlush")
          .mockImplementation(async () => {
            if (++calls === 1) {
              flushing();
              await blocked;
            }
            await originalFlush();
          });
        const ending = current.onInvocationEnd({ ...invocation, status });
        await started;
        now += 25;
        const changed = current.onOperationChange({
          ...invocation,
          updatedOperations: {
            external: {
              ...operation,
              parentId: undefined,
              endTimestamp: new Date(now),
            },
          },
        });
        unblock();
        await Promise.all([ending, changed]);
        const child = spans()[0];
        const enclosing = exporter
          .getFinishedSpans()
          .find(
            (span) =>
              span.spanContext().spanId === child.parentSpanContext?.spanId,
          );
        if (view === "invocation" || status === "SUCCEEDED") {
          expect(enclosing).toBeDefined();
          expect(nanoseconds(child.endTime)).toBeLessThanOrEqual(
            nanoseconds(enclosing!.endTime),
          );
        }
        flush.mockRestore();
      } finally {
        wallClock.mockRestore();
        for (const [name, descriptor] of [
          ["now", originalNow],
          ["timeOrigin", originalOrigin],
        ] as const) {
          if (descriptor)
            Object.defineProperty(otperformance, name, descriptor);
          else Reflect.deleteProperty(otperformance, name);
        }
      }
    },
  );

  it.each([false, true])(
    "exports and flushes a fresh completion after shutdown (started=%s)",
    async (operationStarted) => {
      const current = createPlugin();
      await current.onInvocationStart(invocation);
      if (operationStarted)
        await current.onOperationStart({
          ...operation,
          status: "STARTED",
          endTimestamp: undefined,
        });
      await current.onInvocationEnd({ ...invocation, status: "RETRYING" });
      const flush = jest.spyOn(providers[0], "forceFlush");
      await current.onOperationChange({
        ...invocation,
        updatedOperations: { external: operation },
      });
      expect(
        spans().filter(
          (span) => span.attributes["durable.operation.status"] === "SUCCEEDED",
        ),
      ).toHaveLength(1);
      expect(flush).toHaveBeenCalled();
      flush.mockRestore();
    },
  );

  it.each(["WAIT", "INVOKE", "CHAINED_INVOKE", "CALLBACK"])(
    "preserves %s update fields/status/errors without traversal, with normal-replay dedup and retry redelivery",
    async (type) => {
      for (const status of [
        "SUCCEEDED",
        "FAILED",
        "TIMED_OUT",
        "STOPPED",
        "CANCELLED",
      ] as const) {
        for (const source of ["start", "change"] as const) {
          exporter.reset();
          const completion = {
            ...operation,
            type,
            status,
            ...(status === "SUCCEEDED"
              ? {}
              : { error: new Error(`external ${status}`) }),
          };
          // Fresh instances exercise cold resumes; no process-memory acknowledgement.
          for (const delivery of [0, 1, 2]) {
            const current = createPlugin();
            const updated: Record<string, OperationInfo> =
              delivery !== 2 ? { external: completion } : {};
            const info: InvocationInfo = {
              ...invocation,
              requestId: `request-${delivery}`,
              operations: { external: completion },
              updatedOperations: source === "start" ? updated : {},
            };
            await current.onInvocationStart(info);
            if (source === "change") {
              await current.onOperationChange({
                ...info,
                updatedOperations: updated,
              });
            }
            // No onOperationEnd: workflow suspends or returns without reading it.
            await current.onInvocationEnd({
              ...info,
              status:
                delivery === 0
                  ? "RETRYING"
                  : delivery === 1
                    ? "PENDING"
                    : "SUCCEEDED",
            });
            expect(spans()).toHaveLength(delivery === 0 ? 1 : 2);
          }
          for (const span of spans()) {
            expect(span.attributes).toMatchObject({
              "durable.execution.arn": invocation.executionArn,
              "durable.operation.id": completion.id,
              "durable.operation.type": type,
              "durable.operation.name": completion.name,
              "durable.operation.subtype": completion.subType,
              "durable.operation.status": status,
            });
            expect(span.status.code).toBe(
              status === "SUCCEEDED" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
            );
            if (status !== "SUCCEEDED") {
              expect(span.status.message).toBe(`external ${status}`);
              expect(span.events).toHaveLength(1);
              expect(span.events[0].attributes?.["exception.message"]).toBe(
                `external ${status}`,
              );
              expect(nanoseconds(span.events[0].time)).toBeGreaterThanOrEqual(
                nanoseconds(span.startTime),
              );
              expect(
                nanoseconds(span.events[0].time) - nanoseconds(span.endTime),
              ).toBeLessThanOrEqual(0n);
              if (view === "execution") {
                expect(span.events[0].time).toEqual(
                  timeInputToHrTime(completion.endTimestamp!),
                );
              }
            }
            if (view === "execution") {
              expect(span.startTime).toEqual(timeInputToHrTime(start));
              expect(span.endTime).toEqual(timeInputToHrTime(end));
              expect(span.spanContext().spanId).toBe(
                deriveSpanIdFromOperationId(
                  completion.id,
                  invocation.executionArn,
                ),
              );
              expect(span.parentSpanContext?.spanId).toBe(
                deriveSpanIdFromOperationId(
                  completion.parentId!,
                  invocation.executionArn,
                ),
              );
            } else {
              expect(span.links.map((link) => link.context.spanId)).toContain(
                deriveSpanIdFromOperationId(
                  completion.id,
                  invocation.executionArn,
                ),
              );
            }
          }
        }
      }
    },
  );

  it.each(["WAIT", "INVOKE", "CHAINED_INVOKE", "CALLBACK"])(
    "exports pending replay-marked %s once during traversal without mutating SDK info",
    async (type) => {
      for (const source of ["start", "change"] as const) {
        exporter.reset();
        let current = createPlugin();
        const completion = Object.freeze({ ...operation, type });
        const replay = Object.freeze({ ...completion, isReplay: true });
        await current.onInvocationStart({
          ...invocation,
          updatedOperations: source === "start" ? { external: completion } : {},
        });
        if (source === "change") {
          await current.onOperationChange({
            ...invocation,
            updatedOperations: { external: completion },
          });
        }
        await current.onOperationEnd(replay);
        // Both implementations must export now. Fixing just shouldSkip causes
        // invocation view to acknowledge the completion without creating a span.
        expect(spans()).toHaveLength(1);
        expect(replay.isReplay).toBe(true);
        expect(spans()[0].status.code).toBe(SpanStatusCode.OK);
        // Repeated notifications and end hooks in either order stay deduplicated.
        await current.onOperationChange({
          ...invocation,
          updatedOperations: { external: completion },
        });
        await current.onOperationEnd(replay);
        await current.onInvocationEnd({ ...invocation, status: "RETRYING" });
        expect(spans()).toHaveLength(1);
        // Each major invocation receives a fresh instance; redelivery remains eligible.
        current = createPlugin();
        await current.onInvocationStart({
          ...invocation,
          updatedOperations: { external: completion },
        });
        await current.onOperationEnd(replay);
        await current.onInvocationEnd({ ...invocation, status: "PENDING" });
        expect(spans()).toHaveLength(2);
        // Full history without a fresh update is ordinary replay and adds none.
        current = createPlugin();
        await current.onInvocationStart({
          ...invocation,
          operations: { external: completion },
        });
        await current.onOperationEnd(replay);
        await current.onInvocationEnd({ ...invocation, status: "SUCCEEDED" });
        expect(spans()).toHaveLength(2);
      }
    },
  );

  it.each(["update-first", "end-first"])(
    "deduplicates a normal completion and repeated notifications (%s)",
    async (order) => {
      let current = createPlugin();
      const info: InvocationInfo = {
        ...invocation,
        updatedOperations:
          order === "update-first" ? { external: operation } : {},
      };
      await current.onInvocationStart(info);
      await current.onOperationEnd(operation);
      await current.onOperationChange({
        ...invocation,
        updatedOperations: { external: operation },
      });
      await current.onOperationEnd(operation);
      await current.onInvocationEnd({ ...invocation, status: "PENDING" });
      expect(spans()).toHaveLength(1);
      // The major API creates a fresh instance for every invocation.
      const resumed = {
        ...invocation,
        updatedOperations: { external: operation },
      };
      current = createPlugin(resumed);
      await current.onInvocationStart(resumed);
      await current.onInvocationEnd({ ...invocation, status: "PENDING" });
      expect(spans()).toHaveLength(2);
    },
  );

  it("does not export nonterminal external updates, internal updates or full-history entries", async () => {
    const current = createPlugin();
    const updatedOperations = Object.fromEntries(
      [
        ...["STARTED", "READY", "PENDING"].map((status) => ({
          ...operation,
          id: status,
          status: status as OperationInfo["status"],
        })),
        ...["STEP", "CONTEXT", "EXECUTION", ""].map((type) => ({
          ...operation,
          id: type,
          type,
        })),
        { ...operation, id: "" },
      ].map((info) => [info.id, info]),
    );
    await current.onInvocationStart({
      ...invocation,
      operations: { external: operation },
      updatedOperations,
    });
    await current.onOperationChange({ ...invocation, updatedOperations });
    await current.onInvocationEnd({ ...invocation, status: "PENDING" });
    expect(spans()).toHaveLength(0);
  });

  it("uses the live exception-time fallback when the completion has no end timestamp", async () => {
    // Pin both clock sources to one instant. This verifies live fallback rather
    // than assuming two independent wall/monotonic samples have equal precision.
    const fallbackMillis = end.getTime() + 10_000;
    const originalNow = Object.getOwnPropertyDescriptor(otperformance, "now");
    const originalOrigin = Object.getOwnPropertyDescriptor(
      otperformance,
      "timeOrigin",
    );
    const wallClock = jest.spyOn(Date, "now").mockReturnValue(fallbackMillis);
    Object.defineProperty(otperformance, "now", {
      configurable: true,
      value: () => 100,
    });
    Object.defineProperty(otperformance, "timeOrigin", {
      configurable: true,
      value: fallbackMillis - 100,
    });
    try {
      const current = createPlugin();
      await current.onInvocationStart({
        ...invocation,
        updatedOperations: {
          external: {
            ...operation,
            status: "FAILED",
            endTimestamp: undefined,
            error: new Error("failed without end time"),
          },
        },
      });
      const before = nanoseconds(timeInputToHrTime(new Date(Date.now())));
      await current.onInvocationEnd({ ...invocation, status: "PENDING" });
      const after = nanoseconds(timeInputToHrTime(new Date(Date.now())));
      expect(spans()).toHaveLength(1);
      const span = spans()[0];
      expect(span.events).toHaveLength(1);
      const eventTime = nanoseconds(span.events[0].time);
      if (view === "execution") {
        expect(eventTime).toBeGreaterThanOrEqual(before);
        expect(eventTime).toBeLessThanOrEqual(after);
      }
      expect(eventTime).toBeGreaterThanOrEqual(nanoseconds(span.startTime));
      expect(eventTime - nanoseconds(span.endTime)).toBeLessThanOrEqual(0n);
      expect(span.events[0].attributes?.["exception.message"]).toBe(
        "failed without end time",
      );
    } finally {
      wallClock.mockRestore();
      for (const [name, descriptor] of [
        ["now", originalNow],
        ["timeOrigin", originalOrigin],
      ] as const) {
        if (descriptor) Object.defineProperty(otperformance, name, descriptor);
        else Reflect.deleteProperty(otperformance, name);
      }
    }
  });

  it("does not label a terminal failure without an error as successful", async () => {
    const current = createPlugin();
    await current.onInvocationStart({
      ...invocation,
      updatedOperations: { external: { ...operation, status: "TIMED_OUT" } },
    });
    await current.onInvocationEnd({ ...invocation, status: "PENDING" });
    expect(spans()).toHaveLength(1);
    expect(spans()[0].status.code).toBe(SpanStatusCode.UNSET);
  });
});
