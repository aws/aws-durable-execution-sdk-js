import type { InvocationInfo } from "@aws/durable-execution-sdk-js";

/**
 * Result type returned by context extractors.
 */
export type ContextExtractorResult =
  | {
      traceId: string;
      parentSpanId?: string;
      traceFlags?: number;
    }
  | undefined;

/**
 * A function that extracts upstream trace context from the invocation environment.
 */
export type ContextExtractor = (info: InvocationInfo) => ContextExtractorResult;

/**
 * Reads the X-Ray trace header from the `_X_AMZN_TRACE_ID` environment variable.
 *
 * The durable execution backend propagates the same Root trace ID to every
 * invocation, so all invocations of the same execution share one traceId.
 *
 * X-Ray Header format:
 *   Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1
 *
 * - Extract Root value, strip "1-" prefix and all "-" to get 32-char hex traceId
 * - Extract Parent value for parentSpanId (16-char hex)
 *
 * Returns undefined when _X_AMZN_TRACE_ID is missing or malformed.
 */
export function xRayContextExtractor(
  _info: InvocationInfo,
): ContextExtractorResult {
  const header = process.env._X_AMZN_TRACE_ID;
  if (!header) {
    return undefined;
  }

  // Parse the header into key-value pairs separated by semicolons
  const fields = new Map<string, string>();
  for (const part of header.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx > 0) {
      const key = part.slice(0, eqIdx).trim();
      const value = part.slice(eqIdx + 1).trim();
      fields.set(key, value);
    }
  }

  const root = fields.get("Root");
  if (!root) {
    return undefined;
  }

  // Root format: 1-5759e988-bd862e3fe1be46a994272793
  // Strip the "1-" prefix and remove all dashes to get 32-char hex
  const rootValue = root.startsWith("1-") ? root.slice(2) : root;
  const traceId = rootValue.replace(/-/g, "").toLowerCase();

  // Validate: must be exactly 32 hex characters
  if (!/^[0-9a-f]{32}$/.test(traceId)) {
    return undefined;
  }

  const parent = fields.get("Parent");
  let parentSpanId: string | undefined;
  if (parent && /^[0-9a-f]{16}$/.test(parent.toLowerCase())) {
    parentSpanId = parent.toLowerCase();
  }

  return { traceId, parentSpanId };
}

/**
 * Minimal interface for the Lambda context's clientContext that may be
 * available on the InvocationInfo when the function is invoked via
 * the AWS Mobile SDK or when the backend propagates clientContext.
 */
interface InvocationInfoWithClientContext extends InvocationInfo {
  context?: {
    clientContext?: {
      custom?: Record<string, string>;
    };
  };
}

/**
 * Reads W3C traceparent from `context.clientContext.custom.traceparent`.
 *
 * W3C traceparent format:
 *   00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 *   Format: version-traceId-parentId-traceFlags
 *
 * - traceId is 32 hex chars
 * - parentId is 16 hex chars
 * - flags is 2 hex chars (parsed to number)
 *
 * Returns undefined when clientContext or traceparent is missing or malformed.
 */
export function w3cClientContextExtractor(
  info: InvocationInfo,
): ContextExtractorResult {
  const extendedInfo = info as InvocationInfoWithClientContext;
  const traceparent = extendedInfo.context?.clientContext?.custom?.traceparent;

  if (!traceparent) {
    return undefined;
  }

  return parseW3CTraceparent(traceparent);
}

/**
 * Parses a W3C traceparent header value.
 *
 * Format: version-traceId-parentId-flags
 * Example: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 */
function parseW3CTraceparent(traceparent: string): ContextExtractorResult {
  const parts = traceparent.split("-");

  // Must have exactly 4 parts: version, traceId, parentId, flags
  if (parts.length !== 4) {
    return undefined;
  }

  const [version, traceId, parentId, flags] = parts;

  // Version must be 2 hex chars
  if (!/^[0-9a-f]{2}$/.test(version)) {
    return undefined;
  }

  // TraceId must be 32 hex chars
  if (!/^[0-9a-f]{32}$/.test(traceId)) {
    return undefined;
  }

  // ParentId must be 16 hex chars
  if (!/^[0-9a-f]{16}$/.test(parentId)) {
    return undefined;
  }

  // Flags must be 2 hex chars
  if (!/^[0-9a-f]{2}$/.test(flags)) {
    return undefined;
  }

  const traceFlags = parseInt(flags, 16);

  return {
    traceId,
    parentSpanId: parentId,
    traceFlags,
  };
}
