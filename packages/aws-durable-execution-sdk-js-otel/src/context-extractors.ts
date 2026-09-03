import type { InvocationInfo } from "@aws/durable-execution-sdk-js";

/**
 * The upstream sampling decision carried by a propagated context.
 *
 * Tri-state so that "no usable decision" is distinct from an explicit
 * "do not sample". Extractors use `SAMPLED` / `NOT_SAMPLED` only for explicit
 * upstream values (for example X-Ray `Sampled=1` / `Sampled=0`, or a W3C
 * `traceparent` sampled bit); anything absent or unusable is `UNDECIDED`, which
 * lets the configured sampler decide.
 */
export type Sampling = "SAMPLED" | "NOT_SAMPLED" | "UNDECIDED";

/**
 * Result type returned by context extractors.
 *
 * `sampling` is the tri-state upstream decision. `traceFlags` is retained for
 * backward compatibility with custom extractors: when `sampling` is omitted it
 * is derived from `traceFlags` (sampled bit set -> `SAMPLED`, clear ->
 * `NOT_SAMPLED`), and when neither is provided the decision is `UNDECIDED`.
 *
 * The resolver adopts the trace ID and parent span ID only when they are valid
 * (well-formed, non-zero); an extractor that cannot supply a usable value
 * returns `undefined` for it so the resolver falls back to a deterministic
 * ARN-derived trace and synthetic root.
 */
export type ContextExtractorResult =
  | {
      traceId: string;
      parentSpanId?: string;
      traceFlags?: number;
      sampling?: Sampling;
    }
  | undefined;

const OTEL_TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const OTEL_SPAN_ID_PATTERN = /^[0-9a-f]{16}$/;
const ALL_ZERO_TRACE_ID = "0".repeat(32);
const ALL_ZERO_SPAN_ID = "0".repeat(16);

/**
 * True when `traceId` is a well-formed, non-zero 32-char hex OTel trace ID.
 *
 * Validity is stricter than a format match: an all-zero ID is well-formed hex
 * but invalid, and anchoring an execution on it would split the trace.
 */
export function isValidTraceId(traceId: string | undefined): traceId is string {
  return (
    traceId != null &&
    OTEL_TRACE_ID_PATTERN.test(traceId) &&
    traceId !== ALL_ZERO_TRACE_ID
  );
}

/**
 * True when `spanId` is a well-formed, non-zero 16-char hex OTel span ID.
 */
export function isValidSpanId(spanId: string | undefined): spanId is string {
  return (
    spanId != null &&
    OTEL_SPAN_ID_PATTERN.test(spanId) &&
    spanId !== ALL_ZERO_SPAN_ID
  );
}

/**
 * Resolves the tri-state sampling decision for an extracted context.
 *
 * Prefers an explicit `sampling` value; otherwise derives from `traceFlags`
 * when present; otherwise `UNDECIDED`.
 */
export function resolveSampling(extracted: {
  traceFlags?: number;
  sampling?: Sampling;
}): Sampling {
  if (extracted.sampling) {
    return extracted.sampling;
  }
  if (extracted.traceFlags != null) {
    return (extracted.traceFlags & 1) !== 0 ? "SAMPLED" : "NOT_SAMPLED";
  }
  return "UNDECIDED";
}

/**
 * True when the extracted context carries a complete remote parent: a valid
 * trace ID and a valid parent span ID, so it can serve as a remote parent.
 */
export function hasCompleteRemoteParent(
  extracted: ContextExtractorResult,
): extracted is {
  traceId: string;
  parentSpanId: string;
} & NonNullable<ContextExtractorResult> {
  return (
    extracted != null &&
    isValidTraceId(extracted.traceId) &&
    isValidSpanId(extracted.parentSpanId)
  );
}

/**
 * True when the extracted context carries a valid (well-formed, non-zero) trace
 * ID that the resolver can anchor the durable execution trace on.
 */
export function hasValidTraceId(
  extracted: ContextExtractorResult,
): extracted is {
  traceId: string;
} & NonNullable<ContextExtractorResult> {
  return extracted != null && isValidTraceId(extracted.traceId);
}

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
 * - Extract Sampled: `1` -> SAMPLED, `0` -> NOT_SAMPLED, anything else undecided
 *
 * `Root`, `Parent`, and `Sampled` are parsed independently: only `Sampled=1`
 * and `Sampled=0` are authoritative, and an all-zero Root or Parent is rejected
 * as invalid (it is well-formed hex but not a usable ID). A valid Root with no
 * usable Parent is still returned (the trace ID is usable on its own).
 *
 * Returns undefined when _X_AMZN_TRACE_ID is missing or has no valid Root.
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

  // Reject a missing, malformed, or all-zero Root: it is not a usable trace ID.
  if (!isValidTraceId(traceId)) {
    return undefined;
  }

  // Parent is a 16-char hex span ID; reject an all-zero Parent the same way,
  // and treat an unusable Parent as absent while keeping the valid Root.
  const parent = fields.get("Parent");
  let parentSpanId: string | undefined;
  if (parent && isValidSpanId(parent.toLowerCase())) {
    parentSpanId = parent.toLowerCase();
  }

  // Only Sampled=1 and Sampled=0 are authoritative; anything else is undecided.
  const sampledField = fields.get("Sampled");
  const sampling: Sampling =
    sampledField === "1"
      ? "SAMPLED"
      : sampledField === "0"
        ? "NOT_SAMPLED"
        : "UNDECIDED";

  return { traceId, parentSpanId, sampling };
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

  // TraceId and ParentId must be well-formed AND non-zero. An all-zero trace or
  // parent ID is syntactically 32/16 hex chars but invalid per the W3C spec;
  // accepting it would let a malformed traceparent's sampled bit force or
  // suppress sampling even though the resolver rejects the trace ID and falls
  // back to the ARN-derived trace.
  if (!isValidTraceId(traceId) || !isValidSpanId(parentId)) {
    return undefined;
  }

  // Flags must be 2 hex chars
  if (!/^[0-9a-f]{2}$/.test(flags)) {
    return undefined;
  }

  const traceFlags = parseInt(flags, 16);

  // W3C traceparent carries an explicit sampled bit, so the decision is never
  // UNDECIDED.
  const sampling: Sampling = (traceFlags & 1) !== 0 ? "SAMPLED" : "NOT_SAMPLED";

  return {
    traceId,
    parentSpanId: parentId,
    traceFlags,
    sampling,
  };
}
