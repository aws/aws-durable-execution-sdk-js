import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExecutionOtelPlugin } from "@aws/durable-execution-sdk-js-otel";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";
import { ExampleConfig } from "../../../types";
import { SerializedSpan } from "../shared/otel-test-setup";

/**
 * Detect whether we're running in an ADOT-instrumented cloud environment.
 * The ADOT layer sets AWS_LAMBDA_EXEC_WRAPPER to /opt/otel-instrument,
 * which registers a global TracerProvider and creates an ambient invocation span.
 */
function isAdotEnvironment(): boolean {
  return process.env.AWS_LAMBDA_EXEC_WRAPPER === "/opt/otel-instrument";
}

// Dual-mode setup for ExecutionOtelPlugin with useDefaultTracerProvider:
// - Cloud (ADOT layer): The ADOT layer registers a global TracerProvider and
//   creates an ambient invocation span. ExecutionOtelPlugin picks it up via
//   useDefaultTracerProvider: true. No manual provider registration needed.
// - Local: Register a NodeTracerProvider globally with InMemorySpanExporter,
//   then create ExecutionOtelPlugin with useDefaultTracerProvider: true.
let exporter: InMemorySpanExporter | undefined;
let plugin: ExecutionOtelPlugin;

if (isAdotEnvironment()) {
  // Cloud mode: ADOT layer already registered a global TracerProvider.
  // ExecutionOtelPlugin picks it up via useDefaultTracerProvider.
  // The ambient invocation span from ADOT will be captured in savedInvocationContext.
  plugin = new ExecutionOtelPlugin({ useDefaultTracerProvider: true });
} else {
  // Local mode: Register a global NodeTracerProvider with InMemorySpanExporter
  exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  // Register globally so trace.getTracerProvider() returns this provider
  provider.register();

  // ExecutionOtelPlugin picks up the global provider
  plugin = new ExecutionOtelPlugin({ useDefaultTracerProvider: true });
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
  name: "OTel Default Provider XRay E2E",
  durableConfig: {
    ExecutionTimeout: 120,
    RetentionPeriodInDays: 7,
  },
  excludeRuntimes: ["24.x"],
};

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    // Derive trace ID from X-Ray header for test assertions
    const xRayHeader = process.env._X_AMZN_TRACE_ID;

    // Exercise multiple operation types for X-Ray verification
    const step1 = await context.step("fetch-data", async () => "data-value");

    // Wait to force a multi-invocation workflow
    await context.wait("short-pause", { seconds: 1 });

    const step2 = await context.step(
      "process-data",
      async () => `processed-${step1}`,
    );

    const childResult = await context.runInChildContext(
      "child-operations",
      async (childCtx: DurableContext) => {
        const inner = await childCtx.step(
          "inner-step",
          async () => "inner-value",
        );
        return inner;
      },
    );

    return {
      xRayHeader,
      result: { step1, step2, childResult },
      spans: getSerializedSpans(),
    };
  },
  { plugins: [plugin] },
);
