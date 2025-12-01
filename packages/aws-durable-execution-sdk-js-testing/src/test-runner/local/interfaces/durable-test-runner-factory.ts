import { DurableLambdaHandler } from "@aws/durable-execution-sdk-js";
import { InvokeRequest, TestResult } from "../../types/durable-test-runner";

/**
 * Configuration parameters for LocalDurableTestRunner.
 * @public
 */
export interface LocalDurableTestRunnerParameters {
  /** The handler function to run the execution on */
  handlerFunction: DurableLambdaHandler;
}

/**
 * Factory interface for creating local durable test runner instances.
 * @internal
 */
export interface ILocalDurableTestRunnerFactory {
  /**
   * Creates a new durable test runner instance for executing a durable function.
   *
   * @param handlerFunction - The durable function handler to execute
   * @param skipTime - Whether to skip time delays during execution
   * @returns A new test runner instance
   */
  createRunner<ResultType>(
    params: LocalDurableTestRunnerParameters,
  ): ILocalDurableTestRunnerExecutor<ResultType>;
}

/**
 * @internal
 */
export interface ILocalDurableTestRunnerExecutor<ResultType> {
  /**
   * Executes the durable function and returns the result.
   *
   * @param params - Optional parameters for the execution
   * @returns Promise that resolves with the execution result
   */
  run(params?: InvokeRequest): Promise<TestResult<ResultType>>;
}
