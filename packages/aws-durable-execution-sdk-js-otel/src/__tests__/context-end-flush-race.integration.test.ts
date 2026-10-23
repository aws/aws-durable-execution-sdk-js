import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { context, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { createExecutionOtelPluginFactory } from "../execution-plugin";

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
};
beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

it.each([1, 8, 16])(
  "preserves %s queued completions without ending a detached parent after handler return",
  async (count) => {
    const parentReady = gate(),
      releaseParent = gate(),
      rootLive = gate(),
      releaseRoot = gate();
    const flushEntered = gate(),
      releaseFlush = gate();
    const exporter = new InMemorySpanExporter();
    const delegate = new SimpleSpanProcessor(exporter);
    let provider!: NodeTracerProvider;
    let childWork: PromiseLike<unknown> | undefined;
    const names = Array.from(
      { length: count },
      (_, index) => `external-${index}`,
    );
    const observed = new Set<string>();
    const parentBodyReturned = gate();
    const parentEnded = jest.fn();
    let completionsBeforeEnd = 0;
    const processor: SpanProcessor = {
      onStart(span, parent) {
        delegate.onStart(span, parent);
      },
      onEnd(span) {
        delegate.onEnd(span);
        // Scheduling only: resume the actual provider flush when the real parent
        // End exports its first queued callback. No SDK metadata/hook is injected.
        if (span.name === names[0]) releaseFlush.open();
      },
      async forceFlush() {
        await delegate.forceFlush();
        flushEntered.open();
        await releaseFlush.opened;
      },
      shutdown: () => delegate.shutdown(),
    };
    const plugin = createExecutionOtelPluginFactory({
      contextExtractor: () => undefined,
      flushTimeoutMillis: 5000,
      tracerProviderFactory: (ids) =>
        (provider = new NodeTracerProvider({
          idGenerator: ids(),
          spanProcessors: [processor],
        })),
    });
    const body = jest.fn(async () => {
      rootLive.open();
      await releaseRoot.opened;
      return "saved";
    });
    const handler = withDurableExecution(
      async (_, ctx) => {
        await ctx.runInChildContext("outer", async (outer) => {
          childWork = outer.runInChildContext("parent", async (parent) => {
            for (const name of names) await parent.createCallback(name);
            parentReady.open();
            await releaseParent.opened;
            parentBodyReturned.open();
            return "parent result";
          });
          await parentReady.opened;
          return "outer result";
        });
        return ctx.step("keep-alive", body);
      },
      {
        pluginsConfig: { childOperationsDepth: 2 },
        plugins: [
          {
            createPlugin: () => ({
              async onOperationChange(info) {
                for (const op of Object.values(info.updatedOperations)) {
                  if (
                    names.includes(op.name ?? "") &&
                    op.status === "SUCCEEDED"
                  )
                    observed.add(op.name!);
                }
              },
              async onOperationEnd(info) {
                if (info.name === "parent") parentEnded();
              },
              async onInvocationEnd() {
                completionsBeforeEnd = observed.size;
              },
            }),
          },
          plugin,
        ],
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const execution = runner.run();
    try {
      await rootLive.opened;
      for (const name of names) {
        const op = runner.getOperation(name);
        await op.waitForData(WaitingOperationStatus.STARTED);
        await op.sendCallbackSuccess("callback result");
      }
      releaseRoot.open();
      await flushEntered.opened;
      expect(completionsBeforeEnd).toBe(count);
      releaseParent.open();
      await parentBodyReturned.opened;
      releaseFlush.open();
      const result = await execution;
      expect(result.getStatus()).toBe("SUCCEEDED");
      expect(result.getResult()).toBe("saved");
      expect(body).toHaveBeenCalledTimes(1);
      // The SDK fences this losing continuation after the root handler settles.
      // Its user callback may return, but no late durable parent End is admitted.
      expect(parentEnded).not.toHaveBeenCalled();
      const spans = exporter.getFinishedSpans();
      const callbacks = spans.filter((span) => names.includes(span.name));
      expect(callbacks).toHaveLength(count);
      const parents = spans.filter((span) => span.name === "parent");
      expect(parents).toHaveLength(0);
      const workflow = spans.find((span) => span.name === "Workflow")!;
      expect(workflow).toBeDefined();
      for (const callback of callbacks) {
        expect(callback.parentSpanContext?.spanId).toBe(
          workflow.spanContext().spanId,
        );
        expect(callback.spanContext().traceId).toBe(
          workflow.spanContext().traceId,
        );
      }
    } finally {
      releaseFlush.open();
      releaseParent.open();
      releaseRoot.open();
      void Promise.resolve(childWork).catch(() => undefined);
      await execution.catch(() => undefined);
      await provider.shutdown();
      trace.disable();
      context.disable();
    }
  },
  15000,
);
