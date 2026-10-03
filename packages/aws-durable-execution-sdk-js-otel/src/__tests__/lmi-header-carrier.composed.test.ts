import type { Context as LambdaContext } from "aws-lambda";
import {
  DurableExecutionInvocationInputWithClient,
  withDurableExecution,
  type InvocationInfo,
} from "@aws/durable-execution-sdk-js";
import { context, trace } from "@opentelemetry/api";
import {
  AlwaysOnSampler,
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { createExecutionOtelPluginFactory } from "../execution-plugin";
import { createInvocationOtelPluginFactory } from "../invocation-plugin";
import { deriveExecutionTraceId } from "../execution-trace-context";

it.each([createExecutionOtelPluginFactory, createInvocationOtelPluginFactory])(
  "%p uses invocation-local trace and sampling through the public wrapper",
  async (createFactory) => {
    const originalHeader = process.env._X_AMZN_TRACE_ID;
    process.env._X_AMZN_TRACE_ID =
      "Root=1-aaaaaaaa-aaaaaaaaaaaaaaaaaaaaaaaa;Parent=aaaaaaaaaaaaaaaa;Sampled=1";
    const providers: NodeTracerProvider[] = [];
    try {
      const runs = ["0", "1"].map((sampled) => {
        const exporter = new InMemorySpanExporter();
        const plugin = createFactory({
          tracerProviderFactory: (ids) => {
            const provider = new NodeTracerProvider({
              idGenerator: ids(),
              sampler: new AlwaysOnSampler(),
              spanProcessors: [new SimpleSpanProcessor(exporter)],
            });
            providers.push(provider);
            return provider;
          },
        });
        const xRayTraceId = `Root=1-5759e988-bd862e3fe1be46a99427279${sampled};Parent=53995c3f42cd8ad8;Sampled=${sampled}`;
        let seen: InvocationInfo | undefined;
        let release!: () => void;
        let entered!: () => void;
        const started = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const handler = withDurableExecution(
          async () => {
            entered();
            await gate;
            return "ok";
          },
          {
            plugins: [
              {
                createPlugin: () => ({
                  async onInvocationStart(info) {
                    seen = info;
                  },
                }),
              },
              plugin,
            ],
          },
        );
        const event = new DurableExecutionInvocationInputWithClient(
          {
            DurableExecutionArn: `arn:execution:${sampled}`,
            CheckpointToken: "token",
            InitialExecutionState: {
              Operations: [
                {
                  Id: "execution",
                  Type: "EXECUTION",
                  Status: "STARTED",
                  StartTimestamp: new Date("2026-01-01T00:00:00Z"),
                  ExecutionDetails: { InputPayload: "{}" },
                },
              ],
            },
          },
          {
            checkpoint: jest.fn(() => {
              throw new Error("unexpected checkpoint");
            }),
            getExecutionState: jest.fn(() => {
              throw new Error("unexpected state request");
            }),
          },
        );
        const output = handler(event, {
          awsRequestId: `req-${sampled}`,
          getRemainingTimeInMillis: () => 30000,
          xRayTraceId,
        } as unknown as LambdaContext);
        return {
          exporter,
          started,
          release,
          output,
          sampled,
          xRayTraceId,
          seen: () => seen,
        };
      });
      await Promise.all(runs.map((run) => run.started));
      // Both invocations are active while the other header is being processed.
      runs.forEach((run) => {
        run.release();
      });
      for (const run of runs) {
        expect(await run.output).toEqual({
          Status: "SUCCEEDED",
          Result: '"ok"',
        });
        expect(run.seen()?.xRayTraceId).toBe(run.xRayTraceId);
        const spans = run.exporter.getFinishedSpans();
        if (run.sampled === "0") expect(spans).toHaveLength(0);
        else {
          expect(spans.map((span) => span.name).sort()).toEqual([
            "Invocation",
            "Workflow",
          ]);
          expect(
            new Set(spans.map((span) => span.spanContext().traceId)),
          ).toEqual(new Set(["5759e988bd862e3fe1be46a994272791"]));
          expect(
            spans.every(
              (span) => span.parentSpanContext?.spanId === "53995c3f42cd8ad8",
            ),
          ).toBe(true);
        }
      }
      expect(process.env._X_AMZN_TRACE_ID).toContain("aaaaaaaa");
    } finally {
      await Promise.all(providers.map((provider) => provider.shutdown()));
      if (originalHeader === undefined) delete process.env._X_AMZN_TRACE_ID;
      else process.env._X_AMZN_TRACE_ID = originalHeader;
      context.disable();
      trace.disable();
    }
  },
);

describe.each([
  createExecutionOtelPluginFactory,
  createInvocationOtelPluginFactory,
])("%p runtime carrier availability", (createFactory) => {
  it.each(["absent", "undefined", "null", "empty"])(
    "preserves carrier authority for %s through the public wrapper",
    async (availability) => {
      const previousHeader = process.env._X_AMZN_TRACE_ID;
      const staleTrace = "a".repeat(32);
      process.env._X_AMZN_TRACE_ID =
        "Root=1-aaaaaaaa-aaaaaaaaaaaaaaaaaaaaaaaa;Parent=aaaaaaaaaaaaaaaa;Sampled=1";
      const exporter = new InMemorySpanExporter();
      let provider: NodeTracerProvider | undefined;
      try {
        const plugin = createFactory({
          tracerProviderFactory: (ids) => {
            provider = new NodeTracerProvider({
              idGenerator: ids(),
              sampler: new AlwaysOnSampler(),
              spanProcessors: [new SimpleSpanProcessor(exporter)],
            });
            return provider;
          },
        });
        let seen: InvocationInfo | undefined;
        const handler = withDurableExecution(async () => "ok", {
          plugins: [
            {
              createPlugin: () => ({
                onInvocationStart: async (info) => {
                  seen = info;
                },
              }),
            },
            plugin,
          ],
        });
        const arn = `arn:execution:carrier-${availability}`;
        const start = new Date("2026-01-01T00:00:00Z");
        const event = new DurableExecutionInvocationInputWithClient(
          {
            DurableExecutionArn: arn,
            CheckpointToken: "token",
            InitialExecutionState: {
              Operations: [
                {
                  Id: "execution",
                  Type: "EXECUTION",
                  Status: "STARTED",
                  StartTimestamp: start,
                  ExecutionDetails: { InputPayload: "{}" },
                },
              ],
            },
          },
          {
            checkpoint: jest.fn(() => {
              throw new Error("unexpected checkpoint");
            }),
            getExecutionState: jest.fn(() => {
              throw new Error("unexpected state request");
            }),
          },
        );
        const runtimeContext = {
          awsRequestId: `request-${availability}`,
          getRemainingTimeInMillis: () => 30000,
        };
        if (availability !== "absent") {
          Object.defineProperty(runtimeContext, "xRayTraceId", {
            value:
              availability === "undefined"
                ? undefined
                : availability === "null"
                  ? null
                  : "",
          });
        }
        expect(await handler(event, runtimeContext as LambdaContext)).toEqual({
          Status: "SUCCEEDED",
          Result: '"ok"',
        });
        if (availability === "absent")
          expect(seen).not.toHaveProperty("xRayTraceId");
        else expect(seen?.xRayTraceId).toBe("");
        const spans = exporter.getFinishedSpans();
        expect(spans.length).toBeGreaterThan(0);
        const expected =
          availability === "absent"
            ? staleTrace
            : deriveExecutionTraceId({}, arn, start);
        expect(
          new Set(spans.map((span) => span.spanContext().traceId)),
        ).toEqual(new Set([expected]));
        expect(deriveExecutionTraceId(process.env, arn, start, seen)).toBe(
          expected,
        );
      } finally {
        await provider?.shutdown();
        if (previousHeader === undefined) delete process.env._X_AMZN_TRACE_ID;
        else process.env._X_AMZN_TRACE_ID = previousHeader;
        context.disable();
        trace.disable();
      }
    },
  );
});
