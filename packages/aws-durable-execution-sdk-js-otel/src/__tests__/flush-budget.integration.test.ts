import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { context, propagation, trace } from "@opentelemetry/api";
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import type { SpanExporter } from "@opentelemetry/sdk-trace-node";
import { ExecutionOtelPlugin } from "../execution-plugin";
import { InvocationOtelPlugin } from "../invocation-plugin";
import type { OtelPluginConfig } from "../otel-plugin-config";

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
] as const)("%s view flush wait budget", (_view, Plugin) => {
  it.each(["global", "factory"] as const)(
    "returns the real handler result while an exporter is still waiting (%s)",
    async (mode) => {
      const exporting = gate();
      const releaseExport = gate();
      const delivered = new InMemorySpanExporter();
      const exporter: SpanExporter = {
        export(spans, callback) {
          exporting.open();
          void releaseExport.opened.then(() =>
            delivered.export(spans, callback),
          );
        },
        shutdown: () => delivered.shutdown(),
      };
      const processor = new BatchSpanProcessor(exporter, {
        scheduledDelayMillis: 60000,
        exportTimeoutMillis: 5000,
      });
      let provider!: NodeTracerProvider;
      const config: OtelPluginConfig & { flushTimeoutMillis: number } = {
        contextExtractor: () => undefined,
        flushTimeoutMillis: 20,
      };
      if (mode === "global") {
        provider = new NodeTracerProvider({
          forceFlushTimeoutMillis: 5000,
          spanProcessors: [processor],
        });
        provider.register();
      } else {
        config.tracerProviderFactory = (ids) =>
          (provider = new NodeTracerProvider({
            idGenerator: ids(),
            forceFlushTimeoutMillis: 5000,
            spanProcessors: [processor],
          }));
      }
      const step = jest.fn(async () => "done");
      const handler = withDurableExecution(
        async (_, durable) => durable.step("saved", step),
        { plugins: [new Plugin(config)] },
      );
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });
      const execution = runner.run();
      let observationTimer: ReturnType<typeof setTimeout> | undefined;
      const log = jest.spyOn(console, "error").mockImplementation(() => {});
      try {
        await exporting.opened;
        const observed = await Promise.race([
          execution.then((result) => ({ kind: "returned" as const, result })),
          new Promise<{ kind: "still-waiting" }>((resolve) => {
            observationTimer = setTimeout(
              () => resolve({ kind: "still-waiting" }),
              200,
            );
          }),
        ]);
        expect(observed.kind).toBe("returned");
        if (observed.kind === "returned") {
          expect(observed.result.getStatus()).toBe("SUCCEEDED");
          expect(observed.result.getResult()).toBe("done");
        }
        expect(step).toHaveBeenCalledTimes(1);
        expect(delivered.getFinishedSpans()).toHaveLength(0);
      } finally {
        clearTimeout(observationTimer);
        releaseExport.open();
        await execution;
        await provider.shutdown();
        log.mockRestore();
        trace.disable();
        context.disable();
        propagation.disable();
      }
    },
    15000,
  );
});
