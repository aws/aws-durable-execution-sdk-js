import {
  TestResult,
  TestResultError,
  Invocation,
} from "../durable-test-runner";
import { tryJsonParse } from "../common/utils";
import { TestExecutionResult } from "../common/test-execution-state";
import { OperationStatus, Event } from "@aws-sdk/client-lambda";
import { OperationStorage } from "../common/operation-storage";

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
    events: Event[],
    operationStorage: OperationStorage,
    invocations: Invocation[],
  ): TestResult<ResultType> {
    return {
      getStatus: () => lambdaResponse.status,
      getOperations: (params) => {
        if (params) {
          return operationStorage
            .getOperations()
            .filter((op) => op.getStatus() === params.status);
        }
        return operationStorage.getOperations();
      },
      getInvocations() {
        return invocations;
      },
      getHistoryEvents() {
        return events;
      },
      getResult: () => {
        if (lambdaResponse.status === OperationStatus.FAILED) {
          const errorFromResult = this.getErrorFromResult(lambdaResponse);

          const error = new Error(
            errorFromResult.errorMessage?.trim()
              ? errorFromResult.errorMessage
              : "Execution failed",
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        return this.restoreBatchResults(
          tryJsonParse<ResultType>(lambdaResponse.result),
        ) as ResultType;
      },
      getError: () => {
        if (lambdaResponse.status !== OperationStatus.FAILED) {
          throw new Error("Cannot get error for succeeded execution");
        }
        return this.getErrorFromResult(lambdaResponse);
      },
      print: (config) => {
        const operations = operationStorage.getOperations();
        if (operations.length === 0) {
          console.log("No operations found.");
          return;
        }

        const defaultConfig = {
          parentId: true,
          name: true,
          type: true,
          subType: true,
          status: true,
          startTime: true,
          endTime: true,
          duration: true,
        };
        const finalConfig = { ...defaultConfig, ...config };

        const rows = operations.map((op) => {
          const startTime = op.getStartTimestamp();
          const endTime = op.getEndTimestamp();
          const duration =
            startTime && endTime
              ? `${endTime.getTime() - startTime.getTime()}ms`
              : "-";

          const row: Record<string, string> = {};

          if (finalConfig.parentId) row.parentId = op.getParentId() ?? "-";
          if (finalConfig.name) row.name = op.getName() ?? "-";
          if (finalConfig.type) row.type = op.getType() ?? "-";
          if (finalConfig.subType) row.subType = op.getSubType() ?? "-";
          if (finalConfig.status) row.status = op.getStatus() ?? "-";
          if (finalConfig.startTime)
            row.startTime = startTime ? startTime.toISOString() : "-";
          if (finalConfig.endTime)
            row.endTime = endTime ? endTime.toISOString() : "-";
          if (finalConfig.duration) row.duration = duration;

          return row;
        });

        console.table(rows);
      },
    };
  }

  /**
   * Recursively restores BatchResult objects in the result
   */
  private restoreBatchResults(result: unknown): unknown {
    if (!result || typeof result !== "object") {
      return result;
    }

    if (Array.isArray(result)) {
      return result.map((item) => this.restoreBatchResults(item));
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const resultObj = result as Record<string, unknown>;

    // Check if this looks like a BatchResult object
    if (
      resultObj.all &&
      Array.isArray(resultObj.all) &&
      resultObj.completionReason
    ) {
      // Simple restoration - just add methods back to the object
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const batchResult = result as any;

      // Add BatchResult methods
      batchResult.succeeded = function () {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return this.all.filter(
          (item: any) =>
            item.status === "SUCCEEDED" && item.result !== undefined,
        );
      };

      batchResult.failed = function () {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return this.all.filter(
          (item: any) => item.status === "FAILED" && item.error !== undefined,
        );
      };

      batchResult.getResults = function () {
        return this.succeeded().map((item: any) => item.result);
      };

      batchResult.getErrors = function () {
        return this.failed().map((item: any) => item.error);
      };

      return batchResult;
    }

    // Recursively process object properties
    const restored: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(resultObj)) {
      restored[key] = this.restoreBatchResults(value);
    }
    return restored;
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
