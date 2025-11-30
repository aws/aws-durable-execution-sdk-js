/**
 * Represents the lifecycle state of an operation in the durable execution system.
 * This is distinct from AWS SDK's OperationStatus (PENDING, SUCCEEDED, FAILED).
 */
export enum OperationLifecycleState {
  /**
   * Operation is currently executing user code (step function, waitForCondition check)
   */
  EXECUTING = "EXECUTING",

  /**
   * Operation is waiting for retry timer to expire before re-executing user code
   */
  RETRY_WAITING = "RETRY_WAITING",

  /**
   * Operation is waiting for external event (timer, callback, invoke) but not awaited yet (phase 1)
   */
  IDLE_NOT_AWAITED = "IDLE_NOT_AWAITED",

  /**
   * Operation is waiting for external event and has been awaited (phase 2)
   */
  IDLE_AWAITED = "IDLE_AWAITED",

  /**
   * Operation has completed (success or permanent failure)
   */
  COMPLETED = "COMPLETED",
}
