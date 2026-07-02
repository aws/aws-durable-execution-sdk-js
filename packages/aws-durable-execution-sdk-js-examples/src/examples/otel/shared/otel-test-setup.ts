import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";
import { OtelPlugin } from "@aws/durable-execution-sdk-js-otel";

/**
 * Serialized representation of an OpenTelemetry span for test assertions.
 * Spans are serialized into the execution result so that test runners
 * can inspect span hierarchy, attributes, and links across Lambda invocations.
 */
export interface SerializedSpan {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | undefined;
  attributes: Record<string, string | number>;
  links: Array<{ traceId: string; spanId: string }>;
  status: { code: number; message?: string };
  events: Array<{ name: string; attributes?: Record<string, unknown> }>;
}

export interface OtelTestSetup {
  provider: NodeTracerProvider;
  exporter: InMemorySpanExporter;
  plugin: OtelPlugin;
  getSerializedSpans(): SerializedSpan[];
  reset(): void;
}

/**
 * Creates a shared OTel test infrastructure for integration test examples.
 *
 * Configures a NodeTracerProvider with a SimpleSpanProcessor backed by an
 * InMemorySpanExporter, and passes the provider to OtelPlugin
 * via the `tracerProvider` option.
 *
 * @returns An OtelTestSetup object containing the provider, exporter, plugin,
 * and helper functions for serializing and resetting spans.
 */
export function createOtelTestSetup(): OtelTestSetup {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  const plugin = new OtelPlugin({
    tracerProvider: provider,
  });

  function getSerializedSpans(): SerializedSpan[] {
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

  function reset(): void {
    exporter.reset();
  }

  return {
    provider,
    exporter,
    plugin,
    getSerializedSpans,
    reset,
  };
}
