import { Invocation } from "../../durable-test-runner";
import { InvocationId } from "../../../checkpoint-server/utils/tagged-strings";

/**
 * Manages tracking of invocations and their relationship to operations.
 * Provides functionality to filter operations by invocation.
 */
export class InvocationTracker {
  private invocations = new Map<InvocationId, Invocation>();
  private completedInvocations = new Set<InvocationId>();

  /**
   * Reset all invocation tracking data.
   */
  reset(): void {
    this.invocations = new Map();
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
   * Get all tracked invocations.
   *
   * @returns Array of all invocations
   */
  getInvocations(): Invocation[] {
    return [...this.invocations.values()];
  }
}
