import {
  LambdaHandler,
  DurableExecutionInvocationInput,
} from "@aws/durable-execution-sdk-js";
import { InvokeRequest, TestResult } from "../../durable-test-runner";

/**
 * Factory interface for creating durable test runner instances.
 */
export interface IDurableTestRunnerFactory {
  /**
   * Creates a new durable test runner instance for executing a durable function.
   *
   * @param handlerFunction - The durable function handler to execute
   * @param skipTime - Whether to skip time delays during execution
   * @returns A new test runner instance
   */
  createRunner<ResultType>(
    handlerFunction: LambdaHandler<DurableExecutionInvocationInput>,
    skipTime: boolean
  ): IDurableTestRunnerExecutor<ResultType>;
}

/**
 * Minimal interface for executing durable functions.
 */
export interface IDurableTestRunnerExecutor<ResultType> {
  /**
   * Executes the durable function and returns the result.
   *
   * @param params - Optional parameters for the execution
   * @returns Promise that resolves with the execution result
   */
  run(params?: InvokeRequest): Promise<TestResult<ResultType>>;
}
