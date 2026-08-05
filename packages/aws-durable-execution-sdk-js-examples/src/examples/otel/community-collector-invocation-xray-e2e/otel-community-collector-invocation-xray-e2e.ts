import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  InvocationOtelPlugin,
  ProviderSource,
} from "@aws/durable-execution-sdk-js-otel";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";
import { ExampleConfig } from "../../../types";
import { SerializedSpan } from "../shared/otel-test-setup";
import { xrayE2eWorkflow } from "../shared/xray-e2e-workflow";

/**
 * Detect whether we're running in Lambda (cloud) vs local test runner.
 * Unlike other OTel examples that use isAdotEnvironment() (which checks
 * AWS_LAMBDA_EXEC_WRAPPER), this function intentionally does NOT set that
 * wrapper — the InvocationOtelPlugin manages its own TracerProvider.
 */
function isCloudEnvironment(): boolean {
  return process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined;
}

// Dual-mode setup for InvocationOtelPlugin:
// - Cloud (Lambda): default config (OTLP to community collector at localhost:4318)
// - Local: InMemorySpanExporter for direct span assertions
let exporter: InMemorySpanExporter | undefined;
let plugin: InvocationOtelPlugin;

if (isCloudEnvironment()) {
  // Cloud mode: default AutoOtlp source — plugin builds its own OTLP exporter
  plugin = new InvocationOtelPlugin();
} else {
  // Local mode: custom TracerProvider with InMemorySpanExporter
  exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  plugin = new InvocationOtelPlugin({
    providerSource: ProviderSource.Explicit,
    tracerProvider: provider,
  });
}

export function getSerializedSpans(): SerializedSpan[] {
  if (!exporter) return [];
  const finishedSpans: ReadableSpan[] = exporter.getFinishedSpans();
  return finishedSpans.map((span) => ({
    name: span.name,
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanContext?.spanId,
    attributes: Object.fromEntries(
      Object.entries(span.attributes).filter(
        (entry): entry is [string, string | number] =>
          typeof entry[1] === "string" || typeof entry[1] === "number",
      ),
    ),
    links: span.links.map((link) => ({
      traceId: link.context.traceId,
      spanId: link.context.spanId,
    })),
    status: {
      code: span.status.code,
      ...(span.status.message !== undefined && {
        message: span.status.message,
      }),
    },
    events: span.events.map((event) => ({
      name: event.name,
      ...(event.attributes !== undefined && {
        attributes: event.attributes as Record<string, unknown>,
      }),
    })),
  }));
}

export function resetExporter(): void {
  exporter?.reset();
}

export const config: ExampleConfig = {
  name: "OTel Community Collector Invocation XRay E2E",
  durableConfig: {
    ExecutionTimeout: 120,
    RetentionPeriodInDays: 7,
  },
  excludeRuntimes: ["24.x"],
};

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const { xRayHeader, step1, step2, childResult } =
      await xrayE2eWorkflow(context);

    return {
      xRayHeader,
      result: { step1, step2, childResult },
      spans: getSerializedSpans(),
    };
  },
  { plugins: [plugin] },
);
