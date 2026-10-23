import {
  withDurableExecution,
  DurableExecutionInvocationInputWithClient,
} from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { context, propagation, trace, type Span } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  BatchSpanProcessor,
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

describe.each([
  ["execution", createExecutionOtelPluginFactory],
  ["invocation", createInvocationOtelPluginFactory],
] as const)("%s view lifecycle admission during flush", (view, Plugin) => {
  it.each([false, true])(
    "closes admitted spans and refuses new work after the handler settles (admitted=%s)",
    async (admitted) => {
      trace.disable();
      context.disable();
      propagation.disable();
      const flushEntered = gate(),
        releaseFlush = gate();
      const childReady = gate(),
        attemptStep = gate(),
        attempted = gate();
      const bodyEntered = gate(),
        releaseBody = gate(),
        bodyReturned = gate();
      const exporter = new InMemorySpanExporter();
      const attempts: Span[] = [];
      let provider!: NodeTracerProvider;
      let requests = 0;
      const stepEnded = jest.fn();
      const flushGate: SpanProcessor = {
        onStart(span) {
          if (span.name === "late-step attempt 1") attempts.push(span);
        },
        onEnd() {},
        async forceFlush() {
          flushEntered.open();
          await releaseFlush.opened;
        },
        async shutdown() {},
      };
      const plugin = Plugin({
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
        bodyReturned.open();
        return "late result";
      });
      let childWork: PromiseLike<unknown> | undefined;
      const handler = withDurableExecution(
        async (_, ctx) => {
          childWork = ctx.runInChildContext("child", async (child) => {
            childReady.open();
            if (!admitted) await attemptStep.opened;
            attempted.open();
            return child.step("late-step", step);
          });
          await childReady.opened;
          if (admitted) await bodyEntered.opened;
          return "root result";
        },
        {
          plugins: [
            plugin,
            {
              createPlugin: () => ({
                async onOperationEnd(info) {
                  if (info.name === "late-step") stepEnded();
                },
              }),
            },
          ],
        },
      );
      const runner = new LocalDurableTestRunner({
        handlerFunction: async (event, lambdaContext) => {
          if (!DurableExecutionInvocationInputWithClient.isInstance(event))
            throw new Error("Expected local transport");
          const client = event.durableExecutionClient;
          const checkpoint = client.checkpoint.bind(client);
          client.checkpoint = async (...args) => {
            requests++;
            return checkpoint(...args);
          };
          return handler(event, lambdaContext);
        },
      });
      const execution = runner.run();
      try {
        await flushEntered.opened;
        const requestsAtFlush = requests;
        attemptStep.open();
        await attempted.opened;
        releaseBody.open();
        if (admitted) await bodyReturned.opened;
        // Let already-scheduled continuations run. No elapsed-time threshold or
        // fabricated plugin hook is used to satisfy the admission assertions.
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(step).toHaveBeenCalledTimes(admitted ? 1 : 0);
        expect(stepEnded).not.toHaveBeenCalled();
        expect(requests).toBe(requestsAtFlush);
        expect(attempts).toHaveLength(admitted ? 1 : 0);
        for (const span of attempts) expect(span.isRecording()).toBe(false);
        releaseFlush.open();
        const result = await execution;
        expect(result.getStatus()).toBe("SUCCEEDED");
        expect(result.getResult()).toBe("root result");
        const spans = exporter.getFinishedSpans();
        const exportedAttempts = spans.filter(
          (span) => span.name === "late-step attempt 1",
        );
        expect(exportedAttempts).toHaveLength(admitted ? 1 : 0);
        if (admitted) {
          expect(exportedAttempts[0].spanContext()).toEqual(
            attempts[0].spanContext(),
          );
          expect(
            exportedAttempts[0].attributes["durable.attempt.outcome"],
          ).toBeUndefined();
        }
        const operations = spans.filter((span) => span.name === "late-step");
        expect(operations).toHaveLength(
          admitted && view === "invocation" ? 1 : 0,
        );
        expect(
          operations.every(
            (span) => span.attributes["durable.operation.status"] === "STARTED",
          ),
        ).toBe(true);
      } finally {
        attemptStep.open();
        releaseFlush.open();
        releaseBody.open();
        // Admission closure intentionally preserves the detached durable stack.
        void Promise.resolve(childWork).catch(() => undefined);
        await execution.catch(() => undefined);
        await provider.shutdown();
        trace.disable();
        context.disable();
        propagation.disable();
      }
    },
    15000,
  );
});
