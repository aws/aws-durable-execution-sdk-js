import { createHash } from "crypto";

/**
 * Derives a deterministic 16-character hex spanId from an operationId.
 * The same operation always produces the same spanId across invocations,
 * so the span is only exported once — on completion — with no duplicates.
 */
export function deterministicSpanId(operationId: string): string {
  return createHash("sha256").update(operationId).digest("hex").slice(0, 16);
}
