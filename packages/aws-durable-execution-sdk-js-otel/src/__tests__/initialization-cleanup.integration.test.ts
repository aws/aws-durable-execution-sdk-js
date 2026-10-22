import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { context, propagation, trace, type Span } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { createExecutionOtelPluginFactory } from "../execution-plugin";
import { createInvocationOtelPluginFactory } from "../invocation-plugin";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

it.each([
  ["execution root-start", createExecutionOtelPluginFactory, "start"],
  ["execution root-end", createExecutionOtelPluginFactory, "end"],
  ["invocation root-start", createInvocationOtelPluginFactory, "start"],
  ["invocation root-end", createInvocationOtelPluginFactory, "end"],
] as const)(
  "%s: factory closes allocated Invocation after initialization fails",
  async (_view, createFactory, phase) => {
    trace.disable();
    context.disable();
    propagation.disable();
    const allocated: Span[] = [];
    const startedInvocations: string[] = [];
    const endedInvocations: string[] = [];
    const exporter = new InMemorySpanExporter();
    const failure = new Error(`root ${phase} failure`);
    let rootFailures = 0;
    let provider!: NodeTracerProvider;
    const tracker: SpanProcessor = {
      onStart(span) {
        allocated.push(span);
        if (span.name === "Invocation") {
          expect(span.isRecording()).toBe(true);
          startedInvocations.push(span.spanContext().spanId);
        }
      },
      onEnd(span) {
        if (span.name === "Invocation")
          endedInvocations.push(span.spanContext().spanId);
      },
      async forceFlush() {},
      async shutdown() {},
    };
    const throwing: SpanProcessor = {
      onStart(span) {
        if (phase === "start" && span.name === "DurableExecutionRoot") {
          rootFailures++;
          throw failure;
        }
      },
      onEnd(span) {
        if (phase === "end" && span.name === "DurableExecutionRoot") {
          rootFailures++;
          throw failure;
        }
      },
      async forceFlush() {},
      async shutdown() {},
    };
    const factory = createFactory({
      contextExtractor: () => undefined,
      tracerProviderFactory: (ids) =>
        (provider = new NodeTracerProvider({
          idGenerator: ids(),
          spanProcessors: [
            tracker,
            throwing,
            new SimpleSpanProcessor(exporter),
          ],
        })),
    });
    const work = jest.fn(async () => "saved result");
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_, ctx) => ctx.step("after-failed-initialization", work),
        { plugins: [factory] },
      ),
    });
    try {
      const result = await runner.run();
      expect(result.getStatus()).toBe("SUCCEEDED");
      expect(result.getResult()).toBe("saved result");
      expect(work).toHaveBeenCalledTimes(1);
      expect(rootFailures).toBe(1);
      expect(startedInvocations).toHaveLength(1);
      expect(endedInvocations).toEqual(startedInvocations);
      expect(
        exporter
          .getFinishedSpans()
          .filter((span) => span.name === "Invocation"),
      ).toHaveLength(1);
      expect(
        exporter
          .getFinishedSpans()
          .some((span) => span.name === "after-failed-initialization"),
      ).toBe(false);
    } finally {
      // A throwing onStart can retain a span the tracer never returns to the
      // plugin. Release the test processor's own references only AFTER assertions;
      // the SDK claim above concerns the Invocation it actually obtained.
      for (const span of allocated) {
        try {
          span.end();
        } catch {}
      }
      await provider.shutdown();
      trace.disable();
      context.disable();
      propagation.disable();
    }
  },
  15000,
);
