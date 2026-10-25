import type {
  Attributes,
  HrTime,
  Link,
  SpanContext,
  SpanKind,
  SpanStatus,
} from "@opentelemetry/api";
// A relative path, because the lite SDK is not linked into the workspace node_modules.
import type { DurablePluginFactory } from "../../aws-durable-execution-sdk-js-lite/src/index.js";

/**
 * The resource fields that OTLP serializers read. A Resource from
 * @opentelemetry/resources 2.x, for example from resourceFromAttributes, has them.
 */
export interface OtelResource {
  readonly attributes: Attributes;
  readonly schemaUrl?: string;
}

/** A finished span with the fields of ReadableSpan from @opentelemetry/sdk-trace-base 2.x. */
export interface OtelReadableSpan {
  readonly name: string;
  readonly kind: SpanKind;
  readonly spanContext: () => SpanContext;
  readonly parentSpanContext?: SpanContext;
  readonly startTime: HrTime;
  readonly endTime: HrTime;
  readonly duration: HrTime;
  readonly status: SpanStatus;
  readonly attributes: Attributes;
  readonly links: Link[];
  readonly events: {
    name: string;
    time: HrTime;
    attributes?: Attributes;
    droppedAttributesCount?: number;
  }[];
  readonly ended: boolean;
  readonly resource: OtelResource;
  readonly instrumentationScope: { name: string; version?: string };
  readonly droppedAttributesCount: number;
  readonly droppedEventsCount: number;
  readonly droppedLinksCount: number;
}

/**
 * An OpenTelemetry SpanExporter, for example OTLPTraceExporter. The plugin calls export
 * for each batch, and forceFlush after each successful export, if it exists. It calls
 * export again only after the previous export settled. It never calls shutdown.
 */
export interface OtelSpanExporter {
  /** resultCallback receives code 0 (SUCCESS) or 1 (FAILED). */
  export(
    spans: OtelReadableSpan[],
    resultCallback: (result: { code: number; error?: Error }) => void,
  ): void;
  forceFlush?(): Promise<void>;
}

export interface OtelPluginConfig {
  /** Receives the spans of each sampled invocation. */
  exporter: OtelSpanExporter;
  /** The resource of every span. The default has service.name and the cloud attributes. */
  resource?: OtelResource;
  /** service.name of the default resource. Ignored when resource is set. */
  serviceName?: string;
  /** The fraction of executions to trace, from 0 to 1. Default 1. */
  sampleRate?: number;
  /**
   * Each export waits at most this many milliseconds. onInvocationEnd also waits at
   * most this long for all exports. Default 3000.
   */
  exportTimeoutMs?: number;
  /**
   * Finished operation and attempt spans are exported at most this many milliseconds
   * after they end, during the invocation. 0 exports every span at the end of the
   * invocation. Default 5000.
   */
  flushIntervalMs?: number;
}

/** Returns a plugin factory for withDurableExecution's config.plugins. */
export function createOtelPlugin(
  config: OtelPluginConfig,
): DurablePluginFactory;
