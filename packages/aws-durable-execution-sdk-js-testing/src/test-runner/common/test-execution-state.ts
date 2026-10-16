import { ExecutionStatus } from "@aws-sdk/client-lambda";
import { ErrorObject } from "@aws/durable-execution-sdk-js";
import { defaultLogger } from "../../logger";

export interface TestExecutionResult {
  status?: ExecutionStatus;
  result?: string;
  error?: ErrorObject;
}

/**
 * Manages test execution state and promise resolution for LocalDurableTestRunner.
 * Handles the promise-based coordination between different parts of the execution flow.
 */
export class TestExecutionState {
  private resolveExecution?: (result: TestExecutionResult) => void;
  private rejectExecution?: (error: unknown) => void;
  private settled = false;

  /**
   * Whether {@link resolveWith} or {@link rejectWith} has been called. The handler has then
   * returned a final result, or the execution has failed, even if cleanup is still running.
   */
  isSettled(): boolean {
    return this.settled;
  }

  /**
   * Creates a promise that will be resolved when the execution completes.
   * This promise is used to coordinate the entire execution flow.
   */
  createExecutionPromise(): Promise<TestExecutionResult> {
    return new Promise<TestExecutionResult>((resolve, reject) => {
      this.resolveExecution = resolve;
      this.rejectExecution = reject;
    });
  }

  /**
   * Resolves the execution promise with the given result.
   * This should be called when the handler execution completes successfully.
   */
  resolveWith(result: TestExecutionResult): void {
    this.settled = true;
    this.resolveExecution?.(result);
  }

  /**
   * Rejects the execution promise with the given error.
   * This should be called when the handler execution fails.
   */
  rejectWith(error: unknown): void {
    defaultLogger.debug("Rejecting execution with error", error);
    this.settled = true;
    this.rejectExecution?.(error);
  }
}
