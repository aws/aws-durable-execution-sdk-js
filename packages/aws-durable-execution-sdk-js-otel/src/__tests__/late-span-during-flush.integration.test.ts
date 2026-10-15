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
  BatchSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { ExecutionOtelPlugin } from "../execution-plugin";
import { InvocationOtelPlugin } from "../invocation-plugin";

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

describe.each([
  ["execution", ExecutionOtelPlugin],
  ["invocation", InvocationOtelPlugin],
] as const)("%s view late-span batch delivery", (view, Plugin) => {
  it.each([false, true])(
    "ends and delivers real spans created during flush (completes=%s)",
    async (completes) => {
      const flushEntered = gate();
      const releaseFlush = gate();
      const childReady = gate();
      const bodyEntered = gate();
      const releaseBody = gate();
      const childFinished = gate();
      const exporter = new InMemorySpanExporter();
      const started: SpanContext[] = [];
      const startedAttempts: Span[] = [];
      let provider!: NodeTracerProvider;
      const flushGate: SpanProcessor = {
        onStart(span) {
          if (span.name === "late-step") started.push(span.spanContext());
          if (span.name === "late-step attempt 1") startedAttempts.push(span);
        },
        onEnd() {},
        async forceFlush() {
          flushEntered.open();
          await releaseFlush.opened;
        },
        async shutdown() {},
      };
      const plugin = new Plugin({
        contextExtractor: () => undefined,
        flushTimeoutMillis: 5000,
        tracerProviderFactory: (ids) =>
          (provider = new NodeTracerProvider({
            idGenerator: ids(),
            spanProcessors: [
              flushGate,
              new BatchSpanProcessor(exporter, { scheduledDelayMillis: 60000 }),
            ],
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
              async onOperationEnd(info) {
                if (info.name === "child") childFinished.open();
              },
            },
          ],
        },
      );
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });
      const execution = runner.run();
      try {
        await flushEntered.opened;
        await bodyEntered.opened;
        expect(started).toHaveLength(view === "invocation" ? 1 : 0);
        expect(startedAttempts).toHaveLength(1);
        if (completes) {
          releaseBody.open();
          await childFinished.opened;
        }
        releaseFlush.open();
        const result = await execution;
        expect(result.getStatus()).toBe("SUCCEEDED");
        expect(result.getResult()).toBe("root result");
        expect(step).toHaveBeenCalledTimes(1);
        // Assert before shutdown or any test-side flush can deliver a buffered span.
        expect(startedAttempts[0].isRecording()).toBe(false);
        const spans = exporter.getFinishedSpans();
        const operations = spans.filter((span) => span.name === "late-step");
        expect(operations).toHaveLength(
          view === "invocation" || completes ? 1 : 0,
        );
        if (operations.length) {
          expect(operations[0].spanContext()).toEqual(started[0]);
          expect(operations[0].attributes["durable.operation.status"]).toBe(
            completes ? "SUCCEEDED" : "STARTED",
          );
        }
        const attempts = spans.filter(
          (span) => span.name === "late-step attempt 1",
        );
        expect(attempts).toHaveLength(1);
        if (operations.length) {
          expect(attempts[0].parentSpanContext?.spanId).toBe(
            operations[0].spanContext().spanId,
          );
        }
        if (completes && view === "invocation") {
          // This context was present at the initial unwind, so its later completion
          // still needs a continuation linked to the actually exported first span.
          const children = spans.filter((span) => span.name === "child");
          expect(children).toHaveLength(2);
          expect(
            children[1].links.some(
              (link) =>
                link.context.spanId === children[0].spanContext().spanId,
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
});
