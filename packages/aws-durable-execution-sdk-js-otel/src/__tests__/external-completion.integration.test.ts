import type { HrTime } from "@opentelemetry/api";
import {
  withDurableExecution,
  type InvocationInfo,
  type OperationEndInfo,
  type OperationChangeInfo,
  type DurableContext,
  type DurableInstrumentationPluginFactory,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { timeInputToHrTime } from "@opentelemetry/core";
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

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
};
beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe.each([
  ["execution", createExecutionOtelPluginFactory],
  ["invocation", createInvocationOtelPluginFactory],
] as const)("%s view deferred external completion", (view, createFactory) => {
  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;
  let plugin: DurableInstrumentationPluginFactory;
  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    plugin = createFactory({
      contextExtractor: () => undefined,
      tracerProviderFactory(createIdGenerator) {
        provider = new NodeTracerProvider({
          idGenerator: createIdGenerator(),
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        });
        provider.register();
        return provider;
      },
    });
  });
  afterEach(async () => {
    await provider.shutdown();
    trace.disable();
    context.disable();
  });

  it.each([
    ["callback", false],
    ["callback", true],
    ["invoke", false],
    ["invoke", true],
    ["wait", false],
  ] as const)(
    "exports %s completion received before suspension and read later (failure=%s)",
    async (kind, fails) => {
      // Hold only real step I/O. The handler, checkpoints, updates, suspension,
      // replay and all plugin hooks run through the public SDK and local tester.
      const live = gate();
      const release = gate();
      const starts: InvocationInfo[] = [];
      const ends: OperationEndInfo[] = [];
      const changes: OperationChangeInfo[] = [];
      const body = jest.fn(async () => {
        live.open();
        await release.opened;
        return "saved";
      });
      const handler = withDurableExecution(
        async (_, ctx) => {
          const result = await ctx.runInChildContext("scope", async (child) => {
            let pending: Promise<unknown>;
            if (kind === "callback") {
              [pending] = await child.createCallback<string>("external");
            } else if (kind === "invoke") {
              pending = child.invoke("external", "callee:1", {});
            } else {
              pending = child.wait("external", { seconds: 1 });
            }
            const saved = await child.step("saved", body);
            await child.wait("intervening", { seconds: 1 });
            let outcome: unknown;
            try {
              outcome = await pending;
              if (kind === "wait") outcome = "waited";
            } catch (error) {
              outcome = (error as Error).message;
            }
            // Replay the still-active child once more, after reading the result.
            const [later] = await child.createCallback("later");
            await later;
            return { saved, outcome };
          });
          return result;
        },
        {
          plugins: [
            plugin,
            {
              createPlugin: () => ({
                async onInvocationStart(info) {
                  starts.push(info);
                },
                async onOperationEnd(info) {
                  if (info.name === "external") ends.push(info);
                },
                async onOperationChange(info) {
                  changes.push(info);
                },
              }),
            },
          ],
        },
      );
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });
      runner.registerDurableFunction(
        "callee:1",
        withDurableExecution(async () => {
          if (fails) throw new Error("external failure");
          return "external result";
        }),
      );
      const execution = runner.run();
      await live.opened;
      const external = runner.getOperation("external");
      await external.waitForData(WaitingOperationStatus.STARTED);
      if (kind === "callback") {
        if (fails)
          await external.sendCallbackFailure({
            ErrorMessage: "external failure",
            ErrorType: "ExternalError",
          });
        else await external.sendCallbackSuccess("external result");
      }
      await external.waitForData(WaitingOperationStatus.COMPLETED);
      release.open();
      const later = runner.getOperation("later");
      await later.waitForData(WaitingOperationStatus.STARTED);
      await runner.pauseExecution();
      await later.sendCallbackSuccess("continue");
      await runner.resumeExecution();
      const result = await execution;
      expect(result.getStatus()).toBe("SUCCEEDED");
      expect(result.getResult()).toEqual({
        saved: "saved",
        outcome: fails
          ? "external failure"
          : kind === "wait"
            ? "waited"
            : "external result",
      });
      expect(body).toHaveBeenCalledTimes(1);
      expect(ends.length).toBeGreaterThanOrEqual(2);
      expect(ends.every((end) => end.isReplay)).toBe(true);
      expect(new Set(ends.map((end) => end.id)).size).toBe(1);
      const completion = changes
        .flatMap((change) => Object.values(change.updatedOperations))
        .find(
          (info) =>
            info.name === "external" &&
            info.status === (fails ? "FAILED" : "SUCCEEDED"),
        )!;
      expect(completion).toBeDefined();
      expect(
        starts.every((start) => !start.updatedOperations[completion.id]),
      ).toBe(true);
      const spans = exporter
        .getFinishedSpans()
        .filter((span) => span.name === "external");
      const completed = spans.filter(
        (span) =>
          span.attributes["durable.operation.status"] === completion.status,
      );
      expect(completed).toHaveLength(1);
      expect(completed[0].status.code).toBe(
        fails ? SpanStatusCode.ERROR : SpanStatusCode.OK,
      );
      expect(completed[0].attributes).toMatchObject({
        "durable.operation.id": completion.id,
        "durable.operation.type": completion.type,
        "durable.operation.name": completion.name,
      });
      if (fails) {
        expect(completed[0].events).toHaveLength(1);
        expect(completed[0].events[0].attributes?.["exception.message"]).toBe(
          "external failure",
        );
        const eventTime = nanoseconds(completed[0].events[0].time);
        expect(eventTime).toBeGreaterThanOrEqual(
          nanoseconds(completed[0].startTime),
        );
        expect(
          eventTime - nanoseconds(completed[0].endTime),
        ).toBeLessThanOrEqual(0n);
        if (view === "execution" && completion.endTimestamp) {
          expect(completed[0].events[0].time).toEqual(
            timeInputToHrTime(completion.endTimestamp),
          );
        }
      }
      if (view === "execution") {
        expect(spans).toHaveLength(1);
        expect(completed[0].startTime).toEqual(
          timeInputToHrTime(completion.startTimestamp!),
        );
        // The local tester omits EndTimestamp on wait/invoke updates. The
        // plugin must preserve supplied times and retain its live-end fallback.
        if (completion.endTimestamp) {
          expect(completed[0].endTime).toEqual(
            timeInputToHrTime(completion.endTimestamp),
          );
        } else {
          expect(
            completed[0].duration[0] * 1e9 + completed[0].duration[1],
          ).toBeGreaterThanOrEqual(0);
        }
        expect(completed[0].parentSpanContext?.spanId).toBe(
          deriveSpanIdFromOperationId(
            completion.parentId!,
            starts[0].executionArn,
          ),
        );
      }
      const savedSpans = exporter
        .getFinishedSpans()
        .filter((span) => span.name === "saved");
      expect(savedSpans).toHaveLength(1);
    },
    30000,
  );

  it.each([false, true])(
    "exports a resume update inside a completed child skipped by replay (failure=%s)",
    async (fails) => {
      const live = gate();
      const release = gate();
      const starts: InvocationInfo[] = [];
      const ends: OperationEndInfo[] = [];
      const childBody = jest.fn(async (child: DurableContext) => {
        await child.createCallback("external");
        return "submitted";
      });
      const handler = withDurableExecution(
        async (_, ctx) => {
          const result = await ctx.runInChildContext("scope", childBody);
          await ctx.step("saved", async () => {
            live.open();
            await release.opened;
            return "saved";
          });
          const [later] = await ctx.createCallback("later");
          await later;
          return result;
        },
        {
          plugins: [
            plugin,
            {
              createPlugin: () => ({
                async onInvocationStart(info) {
                  starts.push(info);
                },
                async onOperationEnd(info) {
                  if (info.name === "external") ends.push(info);
                },
              }),
            },
          ],
        },
      );
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });
      const execution = runner.run();
      await live.opened;
      const paused = runner.pauseExecution();
      release.open();
      await paused;
      const external = runner.getOperation("external");
      await external.waitForData(WaitingOperationStatus.STARTED);
      if (fails)
        await external.sendCallbackFailure({
          ErrorMessage: "external failure",
          ErrorType: "ExternalError",
        });
      else await external.sendCallbackSuccess("external result");
      await runner.resumeExecution();
      const later = runner.getOperation("later");
      await later.waitForData(WaitingOperationStatus.STARTED);
      await runner.pauseExecution();
      // Completion has already been exported before another suspension/resume.
      const spans = () =>
        exporter
          .getFinishedSpans()
          .filter(
            (span) =>
              span.name === "external" &&
              span.attributes["durable.operation.status"] ===
                (fails ? "FAILED" : "SUCCEEDED"),
          );
      expect(spans()).toHaveLength(1);
      await later.sendCallbackSuccess("continue");
      await runner.resumeExecution();
      const result = await execution;
      expect(result.getStatus()).toBe("SUCCEEDED");
      expect(result.getResult()).toBe("submitted");
      expect(childBody).toHaveBeenCalledTimes(1);
      expect(ends).toHaveLength(0);
      const updates = starts
        .flatMap((start) => Object.values(start.updatedOperations))
        .filter((info) => info.name === "external");
      expect(updates).toHaveLength(1);
      expect(spans()).toHaveLength(1);
      expect(spans()[0].status.code).toBe(
        fails ? SpanStatusCode.ERROR : SpanStatusCode.OK,
      );
      if (fails) {
        const span = spans()[0];
        expect(span.events).toHaveLength(1);
        expect(nanoseconds(span.events[0].time)).toBeGreaterThanOrEqual(
          nanoseconds(span.startTime),
        );
        expect(
          nanoseconds(span.events[0].time) - nanoseconds(span.endTime),
        ).toBeLessThanOrEqual(0n);
        if (view === "execution") {
          expect(span.events[0].time).toEqual(
            timeInputToHrTime(updates[0].endTimestamp!),
          );
        }
      }
      if (view === "execution") {
        expect(spans()[0].parentSpanContext?.spanId).toBe(
          deriveSpanIdFromOperationId(
            updates[0].parentId!,
            starts[0].executionArn,
          ),
        );
      }
    },
    30000,
  );
});
