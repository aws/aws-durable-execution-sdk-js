import { context, propagation, Context } from "@opentelemetry/api";
import type { InvocationInfo } from "@aws/durable-execution-sdk-js";

export type ContextExtractor = (info: InvocationInfo) => Context;

/**
 * Reads the X-Ray trace header from the _X_AMZN_TRACE_ID environment variable.
 * The durable execution backend propagates the same Root trace ID to every
 * invocation, so all invocations share one traceId.
 */
export const xRayContextExtractor: ContextExtractor = (): Context => {
  const traceHeader = process.env["_X_AMZN_TRACE_ID"];
  if (!traceHeader) return context.active();
  return propagation.extract(context.active(), {
    "X-Amzn-Trace-Id": traceHeader,
  });
};

/**
 * Reads W3C traceparent from context.clientContext.custom.traceparent.
 * Requires the backend clientContext propagation to be enabled.
 */
export const w3cClientContextExtractor: ContextExtractor = (): Context => {
  // In a real Lambda invocation, clientContext would be available on the Lambda context.
  // This extractor is a placeholder for when backend propagation is supported.
  return context.active();
};
