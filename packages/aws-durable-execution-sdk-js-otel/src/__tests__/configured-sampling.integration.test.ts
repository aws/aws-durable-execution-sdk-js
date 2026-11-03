import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { context, propagation, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import {
  withDurableExecution,
  type InvocationInfo,
} from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { createExecutionOtelPluginFactory } from "../execution-plugin";
import { createInvocationOtelPluginFactory } from "../invocation-plugin";

// Fixed IDs on opposite sides of the real SDK's 0.5 ratio threshold.
const sampledId = "00000001000000000000000000000000";
const droppedId = "ffffffff000000000000000000000001";
const parentId = "1234567890abcdef";
const cases = [
  {
    policy: "always_off",
    traceId: sampledId,
    parent: true,
    bit: 1,
    sampled: false,
  },
  {
    policy: "always_off",
    traceId: sampledId,
    parent: false,
    bit: 1,
    sampled: false,
  },
  {
    policy: "always_on",
    traceId: droppedId,
    parent: true,
    bit: 0,
    sampled: true,
  },
  {
    policy: "traceidratio",
    traceId: sampledId,
    parent: true,
    bit: 0,
    sampled: true,
  },
  {
    policy: "traceidratio",
    traceId: droppedId,
    parent: true,
    bit: 1,
    sampled: false,
  },
  {
    policy: "parentbased_traceidratio",
    traceId: sampledId,
    parent: false,
    bit: 0,
    sampled: true,
  },
  {
    policy: "parentbased_traceidratio",
    traceId: droppedId,
    parent: false,
    bit: 1,
    sampled: false,
  },
  {
    policy: "parentbased_traceidratio",
    traceId: droppedId,
    parent: true,
    bit: 1,
    sampled: true,
  },
  {
    policy: "parentbased_traceidratio",
    traceId: sampledId,
    parent: true,
    bit: 0,
    sampled: false,
  },
] as const;

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());
afterEach(() => {
  vi.unstubAllEnvs();
  trace.disable();
  context.disable();
  propagation.disable();
});

describe.each([
  ["execution", createExecutionOtelPluginFactory],
  ["invocation", createInvocationOtelPluginFactory],
] as const)("%s execution sampling across replay", (_view, createFactory) => {
  it.each(cases)(
    "$policy trace=$traceId parent=$parent Sampled=$bit",
    async ({ policy, traceId, parent, bit, sampled }) => {
      vi.stubEnv("OTEL_TRACES_SAMPLER", policy);
      vi.stubEnv("OTEL_TRACES_SAMPLER_ARG", "0.5");
      const header = `Root=${traceId};${parent ? `Parent=${parentId};` : ""}Sampled=${bit}`;
      const exporter = new InMemorySpanExporter();
      let provider!: NodeTracerProvider;
      const factory = createFactory({
        tracerProviderFactory(ids) {
          provider = new NodeTracerProvider({
            idGenerator: ids(),
            spanProcessors: [new SimpleSpanProcessor(exporter)],
          });
          provider.register();
          return provider;
        },
      });
      const started: InvocationInfo[] = [];
      const completed = vi.fn(async () => {
        // Use the same wrapped tracer but a different explicit parent. Ordinary
        // application spans keep the provider's policy, even when durable spans drop.
        const span = provider
          .getTracer("aws-durable-execution-sdk-js")
          .startSpan(
            "application",
            {},
            trace.setSpanContext(ROOT_CONTEXT, {
              traceId: sampledId,
              spanId: parentId,
              traceFlags: 1,
              isRemote: true,
            }),
          );
        span.end();
        return { saved: "checkpointed" };
      });
      const retried = vi.fn(async () => {
        if (retried.mock.calls.length === 1) throw new Error("retry once");
        return "retried";
      });
      const handler = withDurableExecution(
        async (_, ctx) => {
          const saved = await ctx.step("completed", completed);
          await ctx.step("retried", retried, {
            retryStrategy: (_error, attempt) => ({
              shouldRetry: attempt < 2,
              delay: { seconds: 1 },
            }),
          });
          await ctx.wait("pause", { seconds: 1 });
          return saved;
        },
        {
          plugins: [
            factory,
            {
              createPlugin: () => ({
                async onInvocationStart(info) {
                  started.push(info);
                },
              }),
            },
          ],
        },
      );
      const returned: { status: string; spanNames: string[] }[] = [];
      const runner = new LocalDurableTestRunner({
        handlerFunction: async (event, lambdaContext) => {
          const runtimeContext = {
            ...lambdaContext,
            xRayTraceId: header,
          };
          const output = await handler(event, runtimeContext);
          returned.push({
            status: output.Status,
            spanNames: exporter
              .getFinishedSpans()
              .filter((span) => span.name !== "application")
              .map((span) => span.name),
          });
          return output;
        },
      });
      try {
        const result = await runner.run();
        expect(result.getResult()).toEqual({ saved: "checkpointed" });
        expect(completed).toHaveBeenCalledTimes(1);
        expect(retried).toHaveBeenCalledTimes(2);
        expect(runner.getOperation("completed").getStatus()).toBe("SUCCEEDED");
        expect(started[0].isFirstInvocation).toBe(true);
        expect(started.length).toBeGreaterThanOrEqual(3);
        expect(started.slice(1).every((info) => !info.isFirstInvocation)).toBe(
          true,
        );
        expect(returned[0].status).toBe("PENDING");
        expect(returned.at(-1)?.status).toBe("SUCCEEDED");
        const all = exporter.getFinishedSpans();
        expect(all.filter((span) => span.name === "application")).toHaveLength(
          policy === "always_off" ? 0 : 1,
        );
        const durable = all.filter((span) => span.name !== "application");
        if (!sampled) {
          expect(
            returned.every((invocation) => invocation.spanNames.length === 0),
          ).toBe(true);
          expect(durable).toHaveLength(0);
        } else {
          expect(returned[0].spanNames).toContain("Invocation");
          expect(returned[0].spanNames).not.toContain("Workflow");
          expect(durable.map((span) => span.name)).toEqual(
            expect.arrayContaining([
              "Workflow",
              "Invocation",
              "completed",
              "completed attempt 1",
              "retried",
              "retried attempt 1",
              "retried attempt 2",
              "pause",
            ]),
          );
          expect(
            durable.every(
              (span) =>
                span.spanContext().traceId === traceId &&
                (span.spanContext().traceFlags & 1) === 1,
            ),
          ).toBe(true);
          expect(
            durable.some((span) => span.name === "DurableExecutionRoot"),
          ).toBe(!parent);
        }
        expect(trace.getSpan(context.active())).toBeUndefined();
      } finally {
        await provider?.shutdown();
      }
    },
    20_000,
  );
});
