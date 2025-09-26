import {
  LambdaHandler,
  DurableExecutionInvocationInput,
} from "@aws/durable-execution-sdk-js";
import { InvokeRequest, TestResult } from "../../durable-test-runner";

/**
 * Configuration parameters for LocalDurableTestRunner.
 */
export interface LocalDurableTestRunnerParameters {
  /** The handler function to run the execution on */
  handlerFunction: LambdaHandler<DurableExecutionInvocationInput>;
  /**
   * Whether to skip wait/retry intervals by using minimal delays.
   * Will be overridden by calling `skipTime` on individual mocked steps.
   * @default false
   */
  skipTime?: boolean;
}

/**
 * Factory interface for creating local durable test runner instances.
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
    params: LocalDurableTestRunnerParameters
  ): ILocalDurableTestRunnerExecutor<ResultType>;
}

export interface ILocalDurableTestRunnerExecutor<ResultType> {
  /**
   * Executes the durable function and returns the result.
   *
   * @param params - Optional parameters for the execution
   * @returns Promise that resolves with the execution result
   */
  run(params?: InvokeRequest): Promise<TestResult<ResultType>>;
}
