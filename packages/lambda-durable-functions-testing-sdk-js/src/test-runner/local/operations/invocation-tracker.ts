import { OperationStatus } from "@amzn/dex-internal-sdk";
import { LocalOperationStorage } from "./local-operation-storage";
import { Invocation } from "../../durable-test-runner";
import { OperationWithData } from "../../common/operations/operation-with-data";
import { InvocationId } from "../../../checkpoint-server/utils/tagged-strings";

/**
 * Manages tracking of invocations and their relationship to operations.
 * Provides functionality to filter operations by invocation.
 */
export class InvocationTracker {
  private invocations = new Map<InvocationId, Invocation>();
  private invocationOperationsMap = new Map<InvocationId, Set<string>>(); // invocationId -> Set of operationIds
  private completedInvocations = new Set<InvocationId>();

  constructor(private operationStorage: LocalOperationStorage) {}

  /**
   * Reset all invocation tracking data.
   */
  reset(): void {
    this.invocations = new Map();
    this.invocationOperationsMap.clear();
    this.completedInvocations.clear();
  }

  /**
   * Create a new invocation with the given ID.
   *
   * @param invocationId The ID of the invocation
   * @returns The created invocation object
   */
  createInvocation(invocationId: InvocationId): Invocation {
    const invocation: Invocation = {
      id: invocationId,
      getOperations: (params?) => {
        return this.getOperationsForInvocation(invocationId, params?.status);
      },
    };

    this.invocations.set(invocationId, invocation);
    return invocation;
  }

  hasActiveInvocation(): boolean {
    for (const invocationIds of this.invocations.keys()) {
      if (!this.completedInvocations.has(invocationIds)) {
        return true;
      }
    }

    return false;
  }

  completeInvocation(invocationId: InvocationId): void {
    this.completedInvocations.add(invocationId);
  }

  /**
   * Associate an operation with an invocation.
   *
   * @param invocationIds ID of the invocations
   * @param operationId ID of the operation
   */
  associateOperation(invocationIds: InvocationId[], operationId: string): void {
    for (const invocationId of invocationIds) {
      if (!this.invocationOperationsMap.has(invocationId)) {
        this.invocationOperationsMap.set(invocationId, new Set());
      }
      this.invocationOperationsMap.get(invocationId)?.add(operationId);
    }
  }

  /**
   * Get all operations associated with an invocation, optionally filtered by status.
   *
   * @param invocationId ID of the invocation
   * @param status Optional status to filter by
   * @returns Array of operations associated with the invocation
   */
  getOperationsForInvocation(
    invocationId: InvocationId,
    status?: OperationStatus
  ): OperationWithData[] {
    const opIds = this.invocationOperationsMap.get(invocationId) ?? new Set();
    // Filter by operation ID (belonging to this invocation)
    const operations = this.operationStorage
      .getOperations()
      .filter((op) => {
        const id = op.getId();
        return (
          id !== undefined &&
          opIds.has(id) &&
          // Filter by status if provided
          (status !== undefined ? op.getStatus() === status : true)
        );
      });

    return operations;
  }

  /**
   * Get all tracked invocations.
   *
   * @returns Array of all invocations
   */
  getInvocations(): Invocation[] {
    return [...this.invocations.values()];
  }
}
