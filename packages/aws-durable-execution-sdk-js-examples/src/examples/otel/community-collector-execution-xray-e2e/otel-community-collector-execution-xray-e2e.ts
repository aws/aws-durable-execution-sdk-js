import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExecutionOtelPlugin } from "@aws/durable-execution-sdk-js-otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";
import { ExampleConfig } from "../../../types";
import { SerializedSpan } from "../shared/otel-test-setup";
import { xrayE2eWorkflow } from "../shared/xray-e2e-workflow";

/**
 * Detect whether we're running in Lambda (cloud) vs local test runner.
 * Unlike other OTel examples that use isAdotEnvironment() (which checks
 * AWS_LAMBDA_EXEC_WRAPPER), this function intentionally does NOT set that
 * wrapper. The application configures a provider that exports to the collector.
 */
function isCloudEnvironment(): boolean {
  return process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined;
}

// Dual-mode setup for ExecutionOtelPlugin:
// - Cloud (Lambda): application-owned provider exporting to localhost:4318
// - Local: InMemorySpanExporter for direct span assertions
let exporter: InMemorySpanExporter | undefined;
let plugin: ExecutionOtelPlugin;

if (isCloudEnvironment()) {
  // Cloud mode: build an OTLP exporter for the collector extension.
  plugin = new ExecutionOtelPlugin({
    tracerProviderFactory: (createIdGenerator) => {
      const provider = new NodeTracerProvider({
        idGenerator: createIdGenerator(),
        spanProcessors: [
          new BatchSpanProcessor(
            new OTLPTraceExporter({
              url: "http://localhost:4318/v1/traces",
            }),
          ),
        ],
      });
      provider.register();
      return provider;
    },
  });
} else {
  // Local mode: application-owned provider with InMemorySpanExporter.
  exporter = new InMemorySpanExporter();
  plugin = new ExecutionOtelPlugin({
    tracerProviderFactory: (createIdGenerator) =>
      new NodeTracerProvider({
        idGenerator: createIdGenerator(),
        spanProcessors: [new SimpleSpanProcessor(exporter!)],
      }),
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
  name: "OTel Community Collector Execution XRay E2E",
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
