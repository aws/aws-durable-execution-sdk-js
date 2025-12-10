import { TestResult, TestResultError } from "../types/durable-test-runner";
import { tryJsonParse } from "../common/utils";
import { TestExecutionResult } from "../common/test-execution-state";
import { Event, EventType, ExecutionStatus } from "@aws-sdk/client-lambda";
import { OperationStorage } from "../common/operation-storage";
import { transformErrorObjectToErrorResult } from "../../utils";

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
  ): TestResult<ResultType> {
    const invocations = events
      .filter((event) => event.EventType === EventType.InvocationCompleted)
      .map((event) => ({
        startTimestamp: event.InvocationCompletedDetails?.StartTimestamp,
        endTimestamp: event.InvocationCompletedDetails?.EndTimestamp,
        requestId: event.InvocationCompletedDetails?.RequestId,
        error: transformErrorObjectToErrorResult(
          event.InvocationCompletedDetails?.Error?.Payload,
        ),
      }));
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
        if (lambdaResponse.status !== ExecutionStatus.SUCCEEDED) {
          const errorFromResult = this.getErrorFromResult(lambdaResponse);

          const error = new Error(errorFromResult.errorMessage?.trim());

          if (errorFromResult.stackTrace) {
            error.stack = errorFromResult.stackTrace.join("\n");
          }

          throw error;
        }
        return tryJsonParse<ResultType>(lambdaResponse.result);
      },
      getError: () => {
        if (lambdaResponse.status === ExecutionStatus.SUCCEEDED) {
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

  private getErrorFromResult(result: TestExecutionResult): TestResultError {
    if (result.error) {
      return {
        errorMessage: result.error.ErrorMessage,
        errorData: result.error.ErrorData,
        errorType: result.error.ErrorType,
        stackTrace: result.error.StackTrace,
      };
    }

    return {
      errorMessage: `Execution failed with status "${result.status}"`,
      errorData: undefined,
      errorType: undefined,
      stackTrace: undefined,
    };
  }
}
