import {
  withDurableExecution,
  type DurableContext,
} from "@aws/durable-execution-sdk-js";
import { createInvocationOtelPluginFactory } from "@aws/durable-execution-sdk-js-otel";
import { trace, TraceFlags } from "@opentelemetry/api";
import {
  AlwaysOffSampler,
  ConsoleSpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import type { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "OTel Sampling",
  description:
    "Honor a configured AlwaysOff sampler across a durable wait and resume",
  lambdaTimeoutSeconds: 10,
};

// The application owns this provider for the execution environment's lifetime.
export let tracerProvider: NodeTracerProvider;

export interface SamplingObservation {
  requestId: string;
  traceId: string;
  sampled: boolean;
}

function observeSampling(context: DurableContext): SamplingObservation {
  const active = trace.getActiveSpan()!.spanContext();
  return {
    requestId: context.lambdaContext.awsRequestId,
    traceId: active.traceId,
    sampled: (active.traceFlags & TraceFlags.SAMPLED) !== 0,
  };
}

export const handler = withDurableExecution(
  async (_, context) => {
    // Runtime observations belong in steps so completed results survive replay.
    const first = await context.step("observe-initial-sampling", async () =>
      observeSampling(context),
    );
    // The wait exceeds the invocation's remaining budget, forcing a resume.
    await context.wait("resume-with-same-sampler", { seconds: 10 });
    const resumed = await context.step("observe-resumed-sampling", async () =>
      observeSampling(context),
    );
    return { first, resumed };
  },
  {
    plugins: [
      createInvocationOtelPluginFactory({
        tracerProviderFactory(createIdGenerator) {
          tracerProvider = new NodeTracerProvider({
            idGenerator: createIdGenerator(),
            // This programmatic sampler takes precedence over environment settings
            // and drops durable spans even when upstream propagated Sampled=1.
            sampler: new AlwaysOffSampler(),
            spanProcessors: [
              new SimpleSpanProcessor(new ConsoleSpanExporter()),
            ],
          });
          tracerProvider.register();
          return tracerProvider;
        },
      }),
    ],
  },
);
