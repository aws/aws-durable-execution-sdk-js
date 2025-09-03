import { ErrorObject, OperationStatus } from "@amzn/dex-internal-sdk";

export interface TestExecutionResult {
  status: OperationStatus;
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
    this.resolveExecution?.(result);
  }

  /**
   * Rejects the execution promise with the given error.
   * This should be called when the handler execution fails.
   */
  rejectWith(error: unknown): void {
    this.rejectExecution?.(error);
  }
}
