import { ErrorObject, Event } from "@aws-sdk/client-lambda";
import {
  ExecutionId,
  InvocationId,
} from "../../../checkpoint-server/utils/tagged-strings";
import { CheckpointApiClient } from "../api-client/checkpoint-api-client";

/**
 * Manages tracking of invocations in local runner.
 */
export class InvocationTracker {
  private invocations = new Set<InvocationId>();
  private completedInvocations = new Set<InvocationId>();

  constructor(private readonly checkpointApi: CheckpointApiClient) {}

  /**
   * Reset all invocation tracking data.
   */
  reset(): void {
    this.invocations.clear();
    this.completedInvocations.clear();
  }

  /**
   * Create a new invocation with the given ID.
   *
   * @param invocationId The ID of the invocation
   */
  createInvocation(invocationId: InvocationId): void {
    this.invocations.add(invocationId);
  }

  hasActiveInvocation(): boolean {
    for (const invocationIds of this.invocations) {
      if (!this.completedInvocations.has(invocationIds)) {
        return true;
      }
    }

    return false;
  }

  async completeInvocation(
    executionId: ExecutionId,
    invocationId: InvocationId,
    error: ErrorObject | undefined,
  ): Promise<Event> {
    if (!this.invocations.has(invocationId)) {
      throw new Error(`Invocation with ID ${invocationId} not found`);
    }

    // Must add to completed to completed invocations synchronously, otherwise the handler
    // could try to re-invoke the function before an async operation completes.
    this.completedInvocations.add(invocationId);

    const invocationEvent = await this.checkpointApi.completeInvocation(
      executionId,
      invocationId,
      error,
    );

    return invocationEvent;
  }
}
