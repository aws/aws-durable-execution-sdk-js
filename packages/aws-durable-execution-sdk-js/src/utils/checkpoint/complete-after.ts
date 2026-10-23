import { OperationLifecycleState } from "../../types/operation-lifecycle-state";
import { OperationMetadata } from "../../types/operation-lifecycle";
import { Checkpoint } from "./checkpoint-helper";

/**
 * Runs the async work that finishes an operation, such as deserializing its
 * result, while the operation still counts as EXECUTING. Marks the operation
 * COMPLETED when the work settles.
 *
 * The checkpoint manager suspends the invocation once no operation is
 * EXECUTING and another operation, such as a callback, is waiting. If the
 * operation were marked COMPLETED before an async deserializer finished, the
 * invocation could suspend before the code after the operation runs. The
 * code that would unblock the waiting operation would then never run.
 *
 * While `work` runs, the invocation cannot suspend, even if nothing awaits
 * the operation. So `work` that never settles keeps the invocation open until
 * the Lambda timeout.
 *
 * @param metadata - Required when the operation is not tracked yet, for
 * example when a completed result is replayed.
 */
export async function completeAfter<T>(
  checkpoint: Checkpoint,
  stepId: string,
  work: () => Promise<T>,
  metadata?: OperationMetadata,
): Promise<T> {
  checkpoint.markOperationState(
    stepId,
    OperationLifecycleState.EXECUTING,
    metadata ? { metadata } : undefined,
  );
  try {
    return await work();
  } finally {
    checkpoint.markOperationState(stepId, OperationLifecycleState.COMPLETED);
  }
}
