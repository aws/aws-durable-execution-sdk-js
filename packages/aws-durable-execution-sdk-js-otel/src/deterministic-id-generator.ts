import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "crypto";
import {
  RandomIdGenerator,
  type IdGenerator,
} from "@opentelemetry/sdk-trace-node";

export interface IdOverride {
  traceId?: string;
  spanId?: string;
}

/**
 * An OpenTelemetry IdGenerator with execution-scoped deterministic overrides.
 *
 * Overrides are active only while {@link withIds} runs. All other ID generation
 * is delegated to the fallback generator. AsyncLocalStorage makes the override
 * visible to the provider-owned generator without leaking it to unrelated spans
 * or concurrent durable executions.
 */
export class DeterministicIdGenerator implements IdGenerator {
  private static readonly idOverrides = new AsyncLocalStorage<IdOverride>();

  constructor(
    private readonly fallbackIdGenerator: IdGenerator = new RandomIdGenerator(),
  ) {}

  /**
   * Runs a synchronous span-creation callback with deterministic IDs.
   *
   * The span ID is consumed on its first use so re-entrant ID generation cannot
   * accidentally assign the same ID to more than one span.
   */
  withIds<T>(ids: IdOverride, fn: () => T): T {
    return DeterministicIdGenerator.idOverrides.run({ ...ids }, fn);
  }

  /** Generate a 32-char lowercase hex trace ID. */
  generateTraceId(): string {
    const traceId = DeterministicIdGenerator.idOverrides.getStore()?.traceId;
    if (traceId) {
      return traceId;
    }
    return this.fallbackIdGenerator.generateTraceId();
  }

  /** Generate a 16-char lowercase hex span ID. */
  generateSpanId(): string {
    const override = DeterministicIdGenerator.idOverrides.getStore();
    if (override?.spanId) {
      const spanId = override.spanId;
      override.spanId = undefined;
      return spanId;
    }
    return this.fallbackIdGenerator.generateSpanId();
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

/**
 * Derive a deterministic span ID for a Workflow_Span from an execution ARN.
 * Hashes `"workflow:" + executionArn` with SHA-256 and truncates to the first
 * 16 lowercase hex characters.
 *
 * The "workflow:" prefix acts as a salt to ensure the resulting span ID is
 * distinct from IDs produced by `deriveSpanIdFromOperationId` for the same ARN.
 *
 * @param executionArn - The execution ARN string (must be non-empty)
 * @returns A 16-char lowercase hex string, never equal to "0000000000000000"
 * @throws Error if the execution ARN is an empty string
 */
export function deriveWorkflowSpanId(executionArn: string): string {
  if (executionArn === "") {
    throw new Error("Execution ARN must be non-empty");
  }

  const spanId = createHash("sha256")
    .update("workflow:" + executionArn)
    .digest("hex")
    .slice(0, 16);

  // Ensure the result is never all-zeros (astronomically unlikely with SHA-256,
  // but guaranteed by contract)
  if (spanId === "0000000000000000") {
    return "0000000000000001";
  }

  return spanId;
}
