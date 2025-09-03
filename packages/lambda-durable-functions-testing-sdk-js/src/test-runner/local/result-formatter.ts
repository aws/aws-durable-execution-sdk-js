import {
  TestResult,
  TestResultError,
  Invocation,
} from "../durable-test-runner";
import { OperationStorage } from "./operations/operation-storage";
import { tryJsonParse } from "../common/utils";
import { TestExecutionResult } from "./test-execution-state";
import { OperationStatus } from "@amzn/dex-internal-sdk";

/**
 * Handles formatting and processing of execution results for LocalDurableTestRunner.
 * Converts raw lambda responses into structured test results.
 */
export class ResultFormatter<ResultType> {
  /**
   * Formats a lambda response and operation storage into a TestResult.
   *
   * @param lambdaResponse The response from the handler execution
   * @param operationStorage Storage containing completed operations
   * @param invocations Array of invocation records from execution
   * @returns Formatted test result with operations, invocations, and execution result
   */
  formatTestResult(
    lambdaResponse: TestExecutionResult,
    operationStorage: OperationStorage,
    invocations: Invocation[]
  ): TestResult<ResultType> {
    return {
      getCompletedOperations: (params) => {
        if (params) {
          return operationStorage
            .getCompletedOperations()
            .filter((op) => op.getStatus() === params.status);
        }
        return operationStorage.getCompletedOperations();
      },
      getInvocations() {
        return invocations;
      },
      getResult: () => {
        if (lambdaResponse.status === OperationStatus.FAILED) {
          const errorFromResult = this.getErrorFromResult(lambdaResponse);

          const error = new Error(
            errorFromResult.errorMessage?.trim()
              ? errorFromResult.errorMessage
              : "Execution failed"
          );

          if (errorFromResult.stackTrace) {
            error.stack = errorFromResult.stackTrace.join("\n");
          } else if (error.stack) {
            // Remove the code from ResultFormatter from the stack trace since it isn't
            // relevant for debugging.
            const splitStack = error.stack.split("\n");
            error.stack = `${splitStack[0]}\n${splitStack.slice(2).join("\n")}`;
          }

          throw error;
        }
        return tryJsonParse<ResultType>(lambdaResponse.result);
      },
      getError: () => {
        if (lambdaResponse.status !== OperationStatus.FAILED) {
          throw new Error("Cannot get error for succeeded execution");
        }
        return this.getErrorFromResult(lambdaResponse);
      },
    };
  }

  private getErrorFromResult(result: TestExecutionResult): TestResultError {
    if (result.error) {
      return {
        errorMessage: result.error.ErrorMessage,
        errorData: result.error.ErrorData,
        errorType: result.error.ErrorType,
        stackTrace: result.error.StackTrace,
      };
    }

    try {
      // TODO: remove when TS language SDK uses the Error object
      const parsedResult: unknown = JSON.parse(result.result ?? "");
      if (
        typeof parsedResult === "object" &&
        parsedResult !== null &&
        "error" in parsedResult &&
        typeof parsedResult.error === "string"
      ) {
        const errorObject: TestResultError = {
          errorMessage: parsedResult.error,
          errorData: undefined,
          errorType: undefined,
          stackTrace: undefined,
        };

        return errorObject;
      }
    } catch {
      /** ignore JSON parse errors */
    }

    throw new Error("Could not find error result");
  }
}
