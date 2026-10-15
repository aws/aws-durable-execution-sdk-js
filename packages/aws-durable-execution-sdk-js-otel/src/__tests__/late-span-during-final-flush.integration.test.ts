import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import {
  context,
  propagation,
  trace,
  type SpanContext,
  type Span,
} from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { createExecutionOtelPluginFactory } from "../execution-plugin";
import { createInvocationOtelPluginFactory } from "../invocation-plugin";

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
};

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());
beforeEach(() => {
  trace.disable();
  context.disable();
  propagation.disable();
});

it.each([false, true])(
  "factory v2 ends a real operation span created during final flush (completes=%s)",
  async (completes) => {
    const flushEntered = gate();
    const releaseFlush = gate();
    const childReady = gate();
    const bodyEntered = gate();
    const releaseBody = gate();
    const childFinished = gate();
    const exporter = new InMemorySpanExporter();
    const started: SpanContext[] = [];
    let flushCalls = 0;
    let provider!: NodeTracerProvider;
    const flushGate: SpanProcessor = {
      onStart(span) {
        if (span.name === "late-step") started.push(span.spanContext());
      },
      onEnd() {},
      async forceFlush() {
        flushCalls++;
        // Factory v2 first drains while parents remain open. Only the final
        // provider pass is held: this reproduces the post-unwind lifetime edge.
        if (flushCalls === 2) {
          flushEntered.open();
          await releaseFlush.opened;
        }
      },
      async shutdown() {},
    };
    const plugin = createInvocationOtelPluginFactory({
      contextExtractor: () => undefined,
      tracerProviderFactory: (ids) =>
        (provider = new NodeTracerProvider({
          idGenerator: ids(),
          spanProcessors: [flushGate, new SimpleSpanProcessor(exporter)],
        })),
    });
    const step = jest.fn(async () => {
      bodyEntered.open();
      await releaseBody.opened;
      return "late result";
    });
    let childWork: PromiseLike<unknown> | undefined;
    const handler = withDurableExecution(
      async (_, ctx) => {
        childWork = ctx.runInChildContext("child", async (child) => {
          childReady.open();
          // Scheduling-only gate. The actual operation begins after the SDK has
          // entered the real provider's flush, without calling plugin hooks here.
          await flushEntered.opened;
          return child.step("late-step", step);
        });
        await childReady.opened;
        return "root result";
      },
      {
        plugins: [
          plugin,
          {
            createPlugin: () => ({
              async onOperationEnd(info) {
                if (info.name === "child") childFinished.open();
              },
            }),
          },
        ],
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const execution = runner.run();
    try {
      await flushEntered.opened;
      await bodyEntered.opened;
      expect(flushCalls).toBe(2);
      expect(
        exporter.getFinishedSpans().some((span) => span.name === "Invocation"),
      ).toBe(true);
      expect(started).toHaveLength(1);
      if (completes) {
        releaseBody.open();
        await childFinished.opened;
      }
      releaseFlush.open();
      const result = await execution;
      expect(result.getStatus()).toBe("SUCCEEDED");
      expect(result.getResult()).toBe("root result");
      expect(step).toHaveBeenCalledTimes(1);
      expect(flushCalls).toBe(2);
      const spans = exporter.getFinishedSpans();
      const operations = spans.filter((span) => span.name === "late-step");
      expect(operations).toHaveLength(1);
      expect(operations[0].spanContext()).toEqual(started[0]);
      expect(operations[0].attributes["durable.operation.status"]).toBe(
        completes ? "SUCCEEDED" : "STARTED",
      );
      const attempts = spans.filter(
        (span) => span.name === "late-step attempt 1",
      );
      expect(attempts).toHaveLength(1);
      expect(attempts[0].parentSpanContext?.spanId).toBe(
        operations[0].spanContext().spanId,
      );
      if (completes) {
        // This context was present at the initial unwind, so its later completion
        // still needs a continuation linked to the actually exported first span.
        const children = spans.filter((span) => span.name === "child");
        expect(children).toHaveLength(2);
        expect(
          children[1].links.some(
            (link) => link.context.spanId === children[0].spanContext().spanId,
          ),
        ).toBe(true);
      }
    } finally {
      releaseFlush.open();
      releaseBody.open();
      // A step released only after terminal delivery need not settle its
      // checkpoint promise: the invocation has stopped accepting updates.
      // It is intentionally unawaited by the handler, and cleanup must not
      // turn that detached work into a completion dependency of this test.
      if (completes) await Promise.resolve(childWork).catch(() => undefined);
      else void Promise.resolve(childWork).catch(() => undefined);
      await execution.catch(() => undefined);
      await provider.shutdown();
      trace.disable();
      context.disable();
    }
  },
  15000,
);

it.each([
  ["execution", createExecutionOtelPluginFactory],
  ["invocation", createInvocationOtelPluginFactory],
] as const)(
  "%s: a losing parallel branch cannot allocate attempts after final cleanup",
  async (_view, createFactory) => {
    const delayedStart = gate();
    const releaseStart = gate();
    const attemptReached = gate();
    const active = new Map<string, Span>();
    const exporter = new InMemorySpanExporter();
    let provider!: NodeTracerProvider;
    const tracker: SpanProcessor = {
      onStart(span) {
        active.set(span.spanContext().spanId, span);
      },
      onEnd(span) {
        active.delete(span.spanContext().spanId);
      },
      async forceFlush() {},
      async shutdown() {},
    };
    const factory = createFactory({
      contextExtractor: () => undefined,
      tracerProviderFactory: (ids) =>
        (provider = new NodeTracerProvider({
          idGenerator: ids(),
          spanProcessors: [tracker, new SimpleSpanProcessor(exporter)],
        })),
    });
    const lateBody = jest.fn(async () => "late result");
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_, ctx) => {
          const result = await ctx.parallel(
            "first-success",
            [
              {
                name: "winner",
                func: async () => {
                  await delayedStart.opened;
                  return "winner result";
                },
              },
              {
                name: "loser",
                func: async (child) => child.step("delayed-step", lateBody),
              },
            ],
            { completionConfig: { minSuccessful: 1 } },
          );
          return result.getResults();
        },
        {
          plugins: [
            factory,
            {
              createPlugin: () => ({
                async onOperationStart(info) {
                  if (info.name === "delayed-step") {
                    delayedStart.open();
                    await releaseStart.opened;
                  }
                },
                async onOperationAttemptStart(info) {
                  if (info.name === "delayed-step") attemptReached.open();
                },
              }),
            },
          ],
        },
      ),
    });
    const execution = runner.run();
    try {
      const result = await execution;
      expect(result.getStatus()).toBe("SUCCEEDED");
      expect(result.getResult()).toEqual(["winner result"]);
      expect(
        exporter.getFinishedSpans().some((s) => s.name === "Invocation"),
      ).toBe(true);
      expect(active.size).toBe(0);
      releaseStart.open();
      await attemptReached.opened;
      // All real plugin callbacks for the attempt have run before this turn.
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(lateBody).toHaveBeenCalledTimes(1);
      expect([...active.values()].filter((span) => span.isRecording())).toEqual(
        [],
      );
      expect(
        exporter
          .getFinishedSpans()
          .filter((s) => s.name === "delayed-step attempt 1"),
      ).toHaveLength(0);
    } finally {
      releaseStart.open();
      // Release diagnostic tracker handles only after the lifetime assertions.
      for (const span of active.values()) span.end();
      await execution.catch(() => undefined);
      await provider.shutdown();
      trace.disable();
      context.disable();
    }
  },
  15000,
);
