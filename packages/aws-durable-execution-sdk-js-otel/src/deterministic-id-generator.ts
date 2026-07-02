import { createHash } from "crypto";
import type { IdGenerator } from "@opentelemetry/sdk-trace-node";

/**
 * A custom OpenTelemetry IdGenerator that produces deterministic trace and span IDs
 * derived from execution metadata (X-Ray headers, execution ARNs, operation IDs)
 * rather than random values.
 *
 * This ensures that spans from different Lambda invocations of the same durable
 * execution are stitched into a single coherent trace.
 */
export class DeterministicIdGenerator implements IdGenerator {
  private traceId: string | undefined;
  private nextSpanId: string | undefined;

  /**
   * Set the trace ID for all subsequent generateTraceId() calls.
   * This is persistent until setTraceId is called again.
   */
  setTraceId(traceId: string): void {
    this.traceId = traceId;
  }

  /**
   * Set the span ID to return on the next single generateSpanId() call.
   * This is a one-shot override: it is consumed on the next call and then
   * reverts to default behavior.
   */
  setNextSpanId(spanId: string): void {
    this.nextSpanId = spanId;
  }

  /**
   * Generate a 32-char lowercase hex trace ID.
   *
   * If setTraceId has been called, returns that value persistently.
   * Otherwise returns a random 32-char hex string as fallback.
   */
  generateTraceId(): string {
    if (this.traceId) {
      return this.traceId;
    }
    // Fallback: generate a random trace ID
    return createHash("sha256")
      .update(Math.random().toString())
      .digest("hex")
      .slice(0, 32);
  }

  /**
   * Generate a 16-char lowercase hex span ID.
   *
   * If setNextSpanId has been called, returns that value once (one-shot)
   * and then clears it. Otherwise returns a random 16-char hex string.
   */
  generateSpanId(): string {
    if (this.nextSpanId) {
      const spanId = this.nextSpanId;
      this.nextSpanId = undefined;
      return spanId;
    }
    // Fallback: generate a random span ID
    return createHash("sha256")
      .update(Math.random().toString())
      .digest("hex")
      .slice(0, 16);
  }
}

/**
 * Derive a deterministic trace ID from an X-Ray Root field.
 * Strips the `Root=1-` prefix and all `-` separators to produce
 * a valid 32-character lowercase hex OpenTelemetry trace ID.
 *
 * @param xRayRoot - The Root field value, e.g. "1-5759e988-bd862e3fe1be46a994272793"
 * @returns A 32-char lowercase hex string, or undefined if the input is invalid
 */
export function deriveTraceIdFromXRayRoot(
  xRayRoot: string,
): string | undefined {
  // Strip "Root=" prefix if present
  let root = xRayRoot;
  if (root.startsWith("Root=")) {
    root = root.slice(5);
  }

  // Strip the version prefix "1-"
  if (root.startsWith("1-")) {
    root = root.slice(2);
  } else {
    return undefined;
  }

  // Remove all dashes
  const hex = root.replace(/-/g, "");

  // Validate: must be exactly 32 lowercase hex characters
  if (hex.length !== 32 || !/^[0-9a-f]{32}$/.test(hex)) {
    return undefined;
  }

  return hex;
}

/**
 * Derive a deterministic trace ID from an execution ARN by hashing it
 * with SHA-256 and truncating to the first 32 lowercase hex characters.
 *
 * @param executionArn - The execution ARN string
 * @returns A 32-char lowercase hex string
 */
export function deriveTraceIdFromArn(executionArn: string): string {
  return createHash("sha256").update(executionArn).digest("hex").slice(0, 32);
}

/**
 * Derive a deterministic span ID from an operation ID scoped to a specific execution.
 * Hashes `executionArn + ":" + operationId` with SHA-256 and truncates to the first
 * 16 lowercase hex characters.
 *
 * The executionArn is included in the hash input to avoid span ID collisions when
 * different executions (e.g., a parent and child workflow) share the same trace and
 * have operations at the same positional ID.
 *
 * @param operationId - The operation ID string (positional identifier within an execution)
 * @param executionArn - The execution ARN, used to scope span IDs per execution
 * @returns A 16-char lowercase hex string
 */
export function deriveSpanIdFromOperationId(
  operationId: string,
  executionArn: string,
): string {
  return createHash("sha256")
    .update(executionArn + ":" + operationId)
    .digest("hex")
    .slice(0, 16);
}
