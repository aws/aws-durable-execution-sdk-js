import { IdGenerator } from "@opentelemetry/sdk-trace-base";
import { createHash, randomBytes } from "crypto";
import { hashId } from "@aws/durable-execution-sdk-js";

const HASHED_ID_PATTERN = /^[0-9a-f]{16}$/;

/**
 * If already a 16-char hex string (valid span ID), returns as-is. Otherwise hashes it.
 */
function ensureHashedId(id: string): string {
  return HASHED_ID_PATTERN.test(id) ? id : hashId(id);
}

/**
 * Parse the Root trace ID from an X-Ray trace header string.
 *
 * The header format is:
 *   Root=1-<8 hex>-<24 hex>;Parent=<16 hex>;Sampled=0|1
 *
 * Returns the root value (e.g. "1-5759e988-bd862e3fe1be46a994272793")
 * or undefined if the header is missing or malformed.
 */
function parseXRayRootTraceId(
  traceHeader: string | undefined,
): string | undefined {
  if (!traceHeader) return undefined;
  const match = traceHeader.match(/Root=(1-[0-9a-fA-F]{8}-[0-9a-fA-F]{24})/);
  return match ? match[1] : undefined;
}

/**
 * Build an X-Ray-compatible trace ID.
 *
 * First attempts to read the trace ID from the `_X_AMZN_TRACE_ID` environment
 * variable that Lambda populates on each invocation. This ties the durable
 * execution spans to the same trace that X-Ray is already tracking.
 *
 * Falls back to generating a deterministic trace ID from the execution ARN
 * and timestamp when the environment variable is not set (e.g. in tests or
 * non-Lambda environments).
 */
function toXRayTraceId(executionArn: string, timestamp: Date): string {
  const envTraceId = parseXRayRootTraceId(process.env["_X_AMZN_TRACE_ID"]);
  if (envTraceId) return envTraceId;

  // Fallback: deterministic ID from execution ARN + timestamp
  const epochSeconds = Math.floor(timestamp.getTime() / 1000);
  const timePart = epochSeconds.toString(16).padStart(8, "0");
  const hashPart = createHash("md5")
    .update(executionArn)
    .digest("hex")
    .substring(0, 24);
  return `1-${timePart}-${hashPart}`;
}

/**
 * An IdGenerator that produces deterministic spanIds when a pending operation ID is set,
 * and random IDs otherwise. TraceIds are deterministic when an execution ARN is set,
 * ensuring all invocations of the same durable execution share a single trace.
 *
 * Trace IDs embed a real timestamp so they satisfy the X-Ray format requirement
 * (first 8 hex chars = Unix epoch seconds).
 */
export class DeterministicIdGenerator implements IdGenerator {
  private pendingOperationId: string | undefined;
  private executionTraceId: string | undefined;

  /**
   * Set the operation ID to use for the next span's ID.
   * After one span is created, it resets to random.
   */
  setNextSpanOperationId(operationId: string): void {
    this.pendingOperationId = operationId;
  }

  /**
   * Compute and cache the deterministic trace ID for this execution.
   * @param executionArn - The durable execution ARN (used for the hash portion).
   * @param timestamp    - A timestamp to embed in the X-Ray trace ID prefix.
   */
  setExecutionTraceId(executionArn: string, timestamp: Date): void {
    this.executionTraceId = toXRayTraceId(executionArn, timestamp);
  }

  generateTraceId(): string {
    if (this.executionTraceId) {
      return this.executionTraceId;
    }
    return randomBytes(16).toString("hex");
  }

  generateSpanId(): string {
    if (this.pendingOperationId) {
      const id = ensureHashedId(this.pendingOperationId);
      this.pendingOperationId = undefined;
      return id;
    }
    return randomBytes(8).toString("hex");
  }
}
