import { createHash, randomBytes } from "node:crypto";

// Every invocation of one execution derives the same id for the same span. So a span
// that one invocation emits can be the parent of a span that another invocation emits.
// The ids are hashes of the ARN, so no state needs to pass between invocations.

const hash = (text, length) =>
  createHash("sha256").update(text).digest("hex").slice(0, length);

export const traceId = (arn) => hash(arn, 32);

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
// the same decision. The divisor is 2^32, so the ratio is below 1 and sampleRate 1 keeps
// every trace.
export const isSampled = (id, sampleRate) =>
  Number.parseInt(id.slice(-8), 16) / 2 ** 32 < sampleRate;
