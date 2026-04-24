import { IdGenerator } from "@opentelemetry/sdk-trace-base";
import { randomBytes } from "crypto";
import { hashId } from "@aws/durable-execution-sdk-js";

/**
 * An IdGenerator that produces deterministic spanIds when a pending operation ID is set,
 * and random IDs otherwise. TraceIds are always random (or inherited from parent context).
 */
export class DeterministicIdGenerator implements IdGenerator {
  private pendingOperationId: string | undefined;

  /**
   * Set the operation ID to use for the next span's ID.
   * After one span is created, it resets to random.
   */
  setNextSpanOperationId(operationId: string): void {
    this.pendingOperationId = operationId;
  }

  generateTraceId(): string {
    return randomBytes(16).toString("hex");
  }

  generateSpanId(): string {
    if (this.pendingOperationId) {
      const id = hashId(this.pendingOperationId);
      this.pendingOperationId = undefined;
      return id;
    }
    return randomBytes(8).toString("hex");
  }
}
