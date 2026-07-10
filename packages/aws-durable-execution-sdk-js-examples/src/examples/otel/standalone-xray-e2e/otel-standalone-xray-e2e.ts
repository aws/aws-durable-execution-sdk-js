import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { StandaloneOtelPlugin } from "@aws/durable-execution-sdk-js-otel";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";
import { ExampleConfig } from "../../../types";
import { SerializedSpan } from "../shared/otel-test-setup";

/**
 * Detect whether we're running in Lambda (cloud) vs local test runner.
 * Unlike other OTel examples that use isAdotEnvironment() (which checks
 * AWS_LAMBDA_EXEC_WRAPPER), this function intentionally does NOT set that
 * wrapper — the StandaloneOtelPlugin manages its own TracerProvider.
 */
function isCloudEnvironment(): boolean {
  return process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined;
}

// Dual-mode setup for StandaloneOtelPlugin:
// - Cloud (Lambda): default config (OTLP to ADOT collector at localhost:4318)
// - Local: InMemorySpanExporter for direct span assertions
let exporter: InMemorySpanExporter | undefined;
let plugin: StandaloneOtelPlugin;

if (isCloudEnvironment()) {
  // Cloud mode: StandaloneOtelPlugin with default OTLP export to ADOT collector
  plugin = new StandaloneOtelPlugin();
} else {
  // Local mode: custom TracerProvider with InMemorySpanExporter
  exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  plugin = new StandaloneOtelPlugin({ tracerProvider: provider });
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
  name: "OTel Standalone XRay E2E",
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

    // Diagnostic: probe the ADOT collector HTTP endpoint
    let collectorProbe: { status?: number; error?: string } = {};
    if (isCloudEnvironment()) {
      try {
        const http = await import("http");
        const probeResult = await new Promise<{
          status?: number;
          error?: string;
        }>((resolve) => {
          const req = http.request(
            "http://localhost:4318/v1/traces",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              timeout: 2000,
            },
            (res) => {
              resolve({ status: res.statusCode });
            },
          );
          req.on("error", (err) => resolve({ error: err.message }));
          req.on("timeout", () => {
            req.destroy();
            resolve({ error: "timeout" });
          });
          req.write("{}"); // empty payload to test connectivity
          req.end();
        });
        collectorProbe = probeResult;
      } catch (err: any) {
        collectorProbe = { error: err.message ?? String(err) };
      }
    }

    // Exercise multiple operation types for X-Ray verification
    const step1 = await context.step("fetch-data", async () => "data-value");

    // Wait to force a multi-invocation workflow, ensuring the Workflow span
    // spans across invocations and is only exported on terminal status.
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
      debug: {
        collectorProbe,
        otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        otlpTracesEndpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
        lambdaExecWrapper: process.env.AWS_LAMBDA_EXEC_WRAPPER,
        isCloud: isCloudEnvironment(),
      },
    };
  },
  { plugins: [plugin] },
);
