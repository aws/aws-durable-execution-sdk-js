import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { createOtelPluginFactory, type IdGeneratorFactory } from "../index";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: false }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

it.each(["execution", "invocation"] as const)(
  "keeps %s view state isolated across concurrent handlers and replay",
  async (mode) => {
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
    const exporter = new InMemorySpanExporter();
    let provider: NodeTracerProvider | undefined;
    const buildProvider = vi.fn((ids: IdGeneratorFactory) => {
      provider = new NodeTracerProvider({
        idGenerator: ids(),
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      return provider;
    });
    const factory = createOtelPluginFactory({
      mode,
      contextExtractor: () => undefined,
      workflowSpanName: "custom-workflow",
      instrumentationName: "unified-test",
      tracerProviderFactory: buildProvider,
    });
    const sideEffect = vi.fn(async (value: string) => value);
    const handler = withDurableExecution(
      async (event: { value: string }, ctx) => {
        const result = await ctx.step("work-once", () =>
          sideEffect(event.value),
        );
        await ctx.wait("suspend", { seconds: 1 });
        return result;
      },
      { plugins: [factory] },
    );
    const invocationStatuses: string[][] = [[], []];
    const runners = invocationStatuses.map(
      (statuses) =>
        new LocalDurableTestRunner({
          handlerFunction: async (event, lambdaContext) => {
            const result = await handler(event, lambdaContext);
            statuses.push(result.Status);
            return result;
          },
        }),
    );
    try {
      expect(buildProvider).not.toHaveBeenCalled();
      const results = await Promise.all(
        runners.map((runner, index) =>
          runner.run({ payload: { value: `value-${index}` } }),
        ),
      );
      expect(results.map((result) => result.getResult())).toEqual([
        "value-0",
        "value-1",
      ]);
      expect(sideEffect).toHaveBeenCalledTimes(2);
      expect(buildProvider).toHaveBeenCalledTimes(1);
      for (const statuses of invocationStatuses) {
        expect(statuses[0]).toBe("PENDING");
        expect(statuses.at(-1)).toBe("SUCCEEDED");
      }
      const spans = exporter.getFinishedSpans();
      const workflows = spans.filter((span) => span.name === "custom-workflow");
      expect(workflows).toHaveLength(2);
      expect(
        new Set(workflows.map((span) => span.spanContext().traceId)).size,
      ).toBe(2);
      for (const workflow of workflows) {
        const ownSpans = spans.filter(
          (span) =>
            span.attributes["durable.execution.arn"] ===
            workflow.attributes["durable.execution.arn"],
        );
        expect(
          ownSpans.every(
            (span) =>
              span.spanContext().traceId === workflow.spanContext().traceId,
          ),
        ).toBe(true);
        expect(
          ownSpans.every(
            (span) => span.instrumentationScope.name === "unified-test",
          ),
        ).toBe(true);
        const steps = ownSpans.filter((span) => span.name === "work-once");
        expect(steps).toHaveLength(1);
        const parent = ownSpans.find(
          (span) =>
            span.spanContext().spanId === steps[0].parentSpanContext?.spanId,
        );
        expect(parent?.name).toBe(
          mode === "execution" ? "custom-workflow" : "Invocation",
        );
      }
    } finally {
      await provider?.shutdown();
      context.disable();
      trace.disable();
    }
  },
  20000,
);
