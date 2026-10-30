import { createHash, randomBytes } from "node:crypto";

// Every invocation of one execution derives the same id for the same span. So a span
// that one invocation emits can be the parent of a span that another invocation emits.
// The ids are hashes of the ARN, so no state needs to pass between invocations.

const hash = (text, length) =>
  createHash("sha256").update(text).digest("hex").slice(0, length);

// The trace id when the invocation has no valid trace header.
export const traceId = (arn) => hash(arn, 32);

// The X-Ray trace header has the form
// Root=1-<8 hex>-<24 hex>;Parent=<16 hex>;Sampled=<0|1>, with more fields after it.
// The 32 hex digits of Root are the OpenTelemetry trace id. Parent is a span id.
const ROOT = /(?:^|;)\s*Root=1-([0-9a-f]{8})-([0-9a-f]{24})\s*(?:;|$)/;
const PARENT = /(?:^|;)\s*Parent=([0-9a-f]{16})\s*(?:;|$)/;
const SAMPLED = /(?:^|;)\s*Sampled=([01])\s*(?:;|$)/;

// Returns { traceId, parent, sampled } of a header with a valid Root, else undefined.
// parent is undefined when the header has no valid Parent. sampled is true for
// Sampled=1, false for Sampled=0, and undefined otherwise, for example for Sampled=?.
export function parseTraceHeader(header) {
  const root = typeof header === "string" ? ROOT.exec(header) : null;
  if (!root) return undefined;
  const sampled = SAMPLED.exec(header)?.[1];
  return {
    traceId: root[1] + root[2],
    parent: PARENT.exec(header)?.[1],
    sampled: sampled === undefined ? undefined : sampled === "1",
  };
}

// The header that an invoked execution receives. Its Root is this trace. Its Parent is
// the span of the CHAINED_INVOKE operation. The plugin exists only in a sampled
// execution, so Sampled is 1.
export const invokeTraceHeader = (traceId, parentSpanId) =>
  `Root=1-${traceId.slice(0, 8)}-${traceId.slice(8)};Parent=${parentSpanId};Sampled=1`;

export const workflowSpanId = (arn) => hash(`workflow:${arn}`, 16);

// operationId is the record's Id.
export const operationSpanId = (arn, operationId) =>
  hash(`${arn}:${operationId}`, 16);

export const attemptSpanId = (arn, operationId, attempt) =>
  hash(`${arn}:${operationId}:attempt:${attempt}`, 16);

// Without a request id, two invocations would get the same id. So a random id is used.
export const invocationSpanId = (arn, requestId) =>
  requestId === undefined
    ? randomBytes(8).toString("hex")
    : hash(`${arn}:invocation:${requestId}`, 16);

// Head sampling. The trace id is the same in every invocation, so every invocation makes
// the same decision. An invoked execution shares the caller's trace id, so it makes the
// caller's decision too. The divisor is 2^32, so the ratio is below 1 and sampleRate 1 keeps
// every trace.
export const isSampled = (id, sampleRate) =>
  Number.parseInt(id.slice(-8), 16) / 2 ** 32 < sampleRate;

// The sampling decision of one invocation. header is the result of parseTraceHeader.
// 1. Without parentBased, only the ratio decides.
// 2. With parentBased, a header with Sampled=1 or Sampled=0 decides. Lambda gives every
//    invocation of one execution the same Sampled value, so every invocation makes the
//    same decision (README "Sampling").
// 3. With parentBased and no Sampled decision in the header, the ratio decides.
export function sampleDecision(traceId, header, { parentBased, ratio }) {
  if (parentBased && header?.sampled !== undefined) return header.sampled;
  return isSampled(traceId, ratio);
}
