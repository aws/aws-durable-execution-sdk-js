import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { context, propagation, trace, type Span } from "@opentelemetry/api";
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
  NodeTracerProvider,
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
] as const)("%s view final flush admission", (_view, createFactory) => {
  it("freezes the final snapshot before awaiting its last provider flush", async () => {
    trace.disable();
    context.disable();
    propagation.disable();
    const firstFlush = gate(),
      releaseFirst = gate();
    const finalFlush = gate(),
      releaseFinal = gate();
    const firstReady = gate(),
      finalReady = gate();
    const firstHook = gate(),
      finalHook = gate(),
      releaseBodies = gate();
    const exporter = new InMemorySpanExporter();
    const started: Array<{ name: string; span: Span }> = [];
    let provider!: NodeTracerProvider;
    let flushCalls = 0;
    const flushGate: SpanProcessor = {
      onStart(span) {
        started.push({ name: span.name, span });
      },
      onEnd() {},
      async forceFlush() {
        if (++flushCalls === 1) {
          firstFlush.open();
          await releaseFirst.opened;
        } else if (flushCalls === 2) {
          finalFlush.open();
          await releaseFinal.opened;
        }
      },
      async shutdown() {},
    };
    const factory = createFactory({
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
    // Both operations enter the real SDK before the root returns. Delay only
    // forwarding the first attempt-start and second operation-start notification,
    // so snapshot coverage does not admit new business work after return.
    const createPlugin = factory.createPlugin.bind(factory);
    jest.spyOn(factory, "createPlugin").mockImplementation((info) => {
      const plugin = createPlugin(info);
      const operationStart = plugin.onOperationStart.bind(plugin);
      plugin.onOperationStart = async (operation) => {
        if (operation.name === "final-step") {
          finalReady.open();
          await finalFlush.opened;
          await operationStart(operation);
          finalHook.open();
        } else {
          await operationStart(operation);
        }
      };
      const attemptStart = plugin.onOperationAttemptStart.bind(plugin);
      plugin.onOperationAttemptStart = async (attempt) => {
        if (attempt.name === "first-step") {
          firstReady.open();
          await firstFlush.opened;
          await attemptStart(attempt);
          firstHook.open();
        } else {
          await attemptStart(attempt);
        }
      };
      return plugin;
    });
    const firstStep = jest.fn(async () => {
      await releaseBodies.opened;
    });
    const finalStep = jest.fn(async () => {
      await releaseBodies.opened;
    });
    const detached: PromiseLike<unknown>[] = [];
    const handler = withDurableExecution(
      async (_, ctx) => {
        detached.push(
          ctx.runInChildContext("during-open-flush", async (child) => {
            return child.step("first-step", firstStep);
          }),
        );
        detached.push(
          ctx.runInChildContext("during-final-flush", async (child) => {
            return child.step("final-step", finalStep);
          }),
        );
        await Promise.all([firstReady.opened, finalReady.opened]);
        return "root result";
      },
      { plugins: [factory] },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const execution = runner.run();
    try {
      await firstHook.opened;
      const firstAttempt = started.find(
        (item) => item.name === "first-step attempt 1",
      )!;
      expect(firstAttempt).toBeDefined();
      expect(firstAttempt.span.isRecording()).toBe(true);
      releaseFirst.open();
      await finalFlush.opened;
      expect(firstAttempt.span.isRecording()).toBe(false);
      const finalSnapshot = started.length;
      await finalHook.opened;
      // Core admission is already closed. Neither delayed attempt may start its
      // business body, and the finalized OTel hooks cannot revise the snapshot.
      expect(firstStep).not.toHaveBeenCalled();
      expect(finalStep).not.toHaveBeenCalled();
      expect(started).toHaveLength(finalSnapshot);
      expect(started.some((item) => item.name.startsWith("final-step"))).toBe(
        false,
      );
      releaseFinal.open();
      const result = await execution;
      expect(result.getStatus()).toBe("SUCCEEDED");
      expect(result.getResult()).toBe("root result");
      expect(flushCalls).toBe(2);
      expect(started.filter((item) => item.span.isRecording())).toHaveLength(0);
      const attempts = exporter
        .getFinishedSpans()
        .filter((span) => span.name === "first-step attempt 1");
      expect(attempts).toHaveLength(1);
      expect(attempts[0].spanContext()).toEqual(
        firstAttempt.span.spanContext(),
      );
      expect(attempts[0].attributes["durable.attempt.outcome"]).toBeUndefined();
    } finally {
      releaseFirst.open();
      releaseFinal.open();
      releaseBodies.open();
      for (const work of detached)
        void Promise.resolve(work).catch(() => undefined);
      await execution.catch(() => undefined);
      await provider.shutdown();
      trace.disable();
      context.disable();
      propagation.disable();
    }
  }, 15000);
});
