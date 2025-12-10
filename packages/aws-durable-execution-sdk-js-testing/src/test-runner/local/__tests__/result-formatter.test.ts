import { ResultFormatter } from "../result-formatter";
import { LocalOperationStorage } from "../operations/local-operation-storage";
import { OperationWaitManager } from "../operations/operation-wait-manager";
import {
  OperationType,
  Event,
  EventType,
  ExecutionStatus,
} from "@aws-sdk/client-lambda";
import { OperationWithData } from "../../common/operations/operation-with-data";
import { IndexedOperations } from "../../common/indexed-operations";
import { TestExecutionResult } from "../../common/test-execution-state";
import { DurableApiClient } from "../../common/create-durable-api-client";

// Mock OperationStorage
jest.mock("../operations/local-operation-storage");

describe("ResultFormatter", () => {
  let resultFormatter: ResultFormatter<{ success: boolean }>;
  let mockOperationStorage: jest.Mocked<LocalOperationStorage>;
  let mockWaitManager: OperationWaitManager;
  let mockOperationIndex: IndexedOperations;
  let mockApiClient: DurableApiClient;

  beforeEach(() => {
    mockOperationIndex = new IndexedOperations([]);
    mockOperationStorage = new LocalOperationStorage(
      new OperationWaitManager(mockOperationIndex),
      mockOperationIndex,
      mockApiClient,
      jest.fn(),
    ) as jest.Mocked<LocalOperationStorage>;
    resultFormatter = new ResultFormatter<{ success: boolean }>();
    mockWaitManager = new OperationWaitManager(mockOperationIndex);
    mockApiClient = {} as DurableApiClient;
  });

  describe("formatTestResult", () => {
    it("should format a successful lambda response with JSON data", () => {
      const mockOperations = [
        new OperationWithData(
          mockWaitManager,
          mockOperationIndex,
          mockApiClient,
          {
            operation: {
              Id: "op1",
              Name: "operation1",
              Type: OperationType.STEP,
              Status: ExecutionStatus.SUCCEEDED,
              StartTimestamp: new Date(),
            },
            events: [],
          },
        ),
      ];

      mockOperationStorage.getOperations.mockReturnValue(mockOperations);

      const lambdaResponse: TestExecutionResult = {
        status: ExecutionStatus.SUCCEEDED,
        result: JSON.stringify({ success: true }),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
      );

      expect(testResult.getOperations()).toEqual(mockOperations);
      expect(testResult.getInvocations()).toEqual([]);
      expect(testResult.getResult()).toEqual({
        success: true,
      });
    });

    it("should filter operations by status when params are provided", () => {
      // Create mock operations with different statuses
      const succeededOp = new OperationWithData(
        mockWaitManager,
        mockOperationIndex,
        mockApiClient,
        {
          operation: {
            Id: "op1",
            Name: "succeededOp",
            Type: OperationType.STEP,
            Status: ExecutionStatus.SUCCEEDED,
            StartTimestamp: new Date(),
          },
          events: [],
        },
      );

      const failedOp = new OperationWithData(
        mockWaitManager,
        mockOperationIndex,
        mockApiClient,
        {
          operation: {
            Id: "op2",
            Name: "failedOp",
            Type: OperationType.STEP,
            Status: ExecutionStatus.FAILED,
            StartTimestamp: new Date(),
          },
          events: [],
        },
      );

      const mockOperations = [succeededOp, failedOp];
      mockOperationStorage.getOperations.mockReturnValue(mockOperations);

      const lambdaResponse: TestExecutionResult = {
        status: ExecutionStatus.SUCCEEDED,
        result: JSON.stringify({ success: true }),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
      );

      // Test filtering by SUCCEEDED status
      const succeededOps = testResult.getOperations({
        status: ExecutionStatus.SUCCEEDED,
      });
      expect(succeededOps).toHaveLength(1);
      expect(succeededOps[0].getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      // Test filtering by FAILED status
      const failedOps = testResult.getOperations({
        status: ExecutionStatus.FAILED,
      });
      expect(failedOps).toHaveLength(1);
      expect(failedOps[0].getStatus()).toBe(ExecutionStatus.FAILED);
    });

    it("should pass invocations from history to test result", () => {
      mockOperationStorage.getOperations.mockReturnValue([]);

      const lambdaResponse: TestExecutionResult = {
        status: ExecutionStatus.SUCCEEDED,
        result: JSON.stringify({ success: true }),
      };

      const invocationCompletedDate1 = {
        startTimestamp: new Date(1),
        endTimestamp: new Date(2),
      };

      const invocationCompletedDate2 = {
        startTimestamp: new Date(3),
        endTimestamp: new Date(4),
      };

      const invocationCompletedDate3 = {
        startTimestamp: new Date(5),
      };

      const mockEvents: Event[] = [
        {
          EventType: EventType.StepStarted,
          StepStartedDetails: {},
        },
        {
          EventType: EventType.InvocationCompleted,
          InvocationCompletedDetails: {
            StartTimestamp: invocationCompletedDate1.startTimestamp,
            EndTimestamp: invocationCompletedDate1.endTimestamp,
            Error: undefined,
            RequestId: "inv-1",
          },
        },
        {
          EventType: EventType.StepStarted,
          StepStartedDetails: {},
        },
        {
          EventType: EventType.InvocationCompleted,
          InvocationCompletedDetails: {
            StartTimestamp: invocationCompletedDate2.startTimestamp,
            EndTimestamp: invocationCompletedDate2.endTimestamp,
            Error: {
              Payload: {
                ErrorMessage: "hello world",
              },
            },
            RequestId: "inv-2",
          },
        },
        {
          EventType: EventType.StepSucceeded,
          StepSucceededDetails: {
            Result: {},
            RetryDetails: {},
          },
        },
        {
          EventType: EventType.InvocationCompleted,
          InvocationCompletedDetails: {
            StartTimestamp: invocationCompletedDate3.startTimestamp,
            EndTimestamp: undefined,
            Error: {
              Payload: {},
            },
            RequestId: "inv-3",
          },
        },
      ];

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        mockEvents,
        mockOperationStorage,
      );

      const returnedInvocations = testResult.getInvocations();
      expect(returnedInvocations).toEqual([
        {
          startTimestamp: invocationCompletedDate1.startTimestamp,
          endTimestamp: invocationCompletedDate1.endTimestamp,
          error: undefined,
          requestId: "inv-1",
        },
        {
          startTimestamp: invocationCompletedDate2.startTimestamp,
          endTimestamp: invocationCompletedDate2.endTimestamp,
          error: {
            errorMessage: "hello world",
          },
          requestId: "inv-2",
        },
        {
          startTimestamp: invocationCompletedDate3.startTimestamp,
          endTimestamp: undefined,
          error: {},
          requestId: "inv-3",
        },
      ]);
      expect(returnedInvocations).toHaveLength(3);
      expect(returnedInvocations[0].requestId).toBe("inv-1");
      expect(returnedInvocations[1].requestId).toBe("inv-2");
      expect(returnedInvocations[2].requestId).toBe("inv-3");
    });

    it("should handle undefined value", () => {
      mockOperationStorage.getOperations.mockReturnValue([]);

      const lambdaResponse: TestExecutionResult = {
        status: ExecutionStatus.SUCCEEDED,
        result: "",
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
      );

      expect(testResult.getResult()).toEqual("");
    });

    it("should handle non-JSON value by returning raw value", () => {
      mockOperationStorage.getOperations.mockReturnValue([]);

      const lambdaResponse: TestExecutionResult = {
        status: ExecutionStatus.SUCCEEDED,
        result: "raw-string-value",
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
      );

      expect(testResult.getResult()).toEqual("raw-string-value");
    });

    it("should handle invalid JSON by returning raw value", () => {
      mockOperationStorage.getOperations.mockReturnValue([]);

      const lambdaResponse: TestExecutionResult = {
        status: ExecutionStatus.SUCCEEDED,
        result: "{ invalid json",
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
      );

      expect(testResult.getResult()).toEqual("{ invalid json");
    });

    it("should return operations from operation storage", () => {
      const mockOperations = [
        {
          operation: {
            Id: "op1",
            Name: "operation1",
            Status: ExecutionStatus.SUCCEEDED,
            Type: OperationType.STEP,
            StartTimestamp: new Date(),
          },
          update: {},
          events: [],
        },
        {
          operation: {
            Id: "op2",
            Name: "operation2",
            Status: ExecutionStatus.SUCCEEDED,
            Type: OperationType.WAIT,
            StartTimestamp: new Date(),
          },
          update: {},
          events: [],
        },
      ].map(
        (checkpointOperation) =>
          new OperationWithData(
            mockWaitManager,
            mockOperationIndex,
            mockApiClient,
            checkpointOperation,
          ),
      );

      mockOperationStorage.getOperations.mockReturnValue(mockOperations);

      const lambdaResponse: TestExecutionResult = {
        status: ExecutionStatus.SUCCEEDED,
        result: JSON.stringify({ success: true }),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
      );

      expect(testResult.getOperations()).toEqual(mockOperations);
      expect(mockOperationStorage.getOperations).toHaveBeenCalledTimes(1);
    });
  });

  describe("formatExecutionResult", () => {
    it("should handle complex nested JSON data", () => {
      mockOperationStorage.getOperations.mockReturnValue([]);

      const complexData = {
        success: true,
        data: {
          items: [1, 2, 3],
          nested: { value: "test" },
        },
      };

      const lambdaResponse: TestExecutionResult = {
        status: ExecutionStatus.SUCCEEDED,
        result: JSON.stringify(complexData),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
      );

      expect(testResult.getResult()).toEqual(complexData);
    });

    it("should not clean stack trace if error had no stack trace", () => {
      const lambdaResponse: TestExecutionResult = {
        status: ExecutionStatus.FAILED,
        result: JSON.stringify({ error: "Test error" }),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
      );

      let thrownError: Error;
      try {
        testResult.getResult();
      } catch (error) {
        thrownError = error as Error;
      }
      expect(thrownError!.stack).toBeDefined();
      expect(thrownError!.stack).toContain("result-formatter.ts");
    });
  });

  describe("getError behavior", () => {
    it("should return generic error when error object is missing", () => {
      const mockError = "Handler execution failed";

      const lambdaResponse: TestExecutionResult = {
        status: ExecutionStatus.FAILED,
        result: JSON.stringify({ error: mockError }),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
      );

      const error = testResult.getError();
      expect(error).toEqual({
        errorMessage: 'Execution failed with status "FAILED"',
        errorData: undefined,
        errorType: undefined,
        stackTrace: undefined,
      });
    });

    it("should throw error when called on successful execution", () => {
      const lambdaResponse: TestExecutionResult = {
        status: ExecutionStatus.SUCCEEDED,
        result: JSON.stringify({ success: true }),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
      );

      expect(() => testResult.getError()).toThrow(
        "Cannot get error for succeeded execution",
      );
    });

    it("should return ErrorObject when error object is specified", () => {
      const lambdaResponse: TestExecutionResult = {
        status: ExecutionStatus.FAILED,
        result: JSON.stringify({ someOtherField: "value" }),
        error: {
          ErrorData: "my-error-data",
          ErrorMessage: "my-error-message",
          ErrorType: "my-error-type",
          StackTrace: ["my-stack-trace"],
        },
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
      );

      expect(testResult.getError()).toEqual({
        errorData: "my-error-data",
        errorMessage: "my-error-message",
        errorType: "my-error-type",
        stackTrace: ["my-stack-trace"],
      });
    });
  });

  describe("getHistoryEvents", () => {
    it("should return events passed to formatTestResult", () => {
      mockOperationStorage.getOperations.mockReturnValue([]);

      const mockEvents: Event[] = [
        {
          Id: "event-1",
          Name: "TestEvent1",
          EventTimestamp: new Date("2023-01-01T00:00:00Z"),
        },
        {
          Id: "event-2",
          Name: "TestEvent2",
          EventTimestamp: new Date("2023-01-01T00:01:00Z"),
        },
      ];

      const lambdaResponse: TestExecutionResult = {
        status: ExecutionStatus.SUCCEEDED,
        result: JSON.stringify({ success: true }),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        mockEvents,
        mockOperationStorage,
      );

      expect(testResult.getHistoryEvents()).toEqual(mockEvents);
    });

    it("should return empty array when no events provided", () => {
      mockOperationStorage.getOperations.mockReturnValue([]);

      const lambdaResponse: TestExecutionResult = {
        status: ExecutionStatus.SUCCEEDED,
        result: JSON.stringify({ success: true }),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
      );

      expect(testResult.getHistoryEvents()).toEqual([]);
    });
  });

  describe("getStatus", () => {
    it("should return status from lambda response", () => {
      mockOperationStorage.getOperations.mockReturnValue([]);

      const lambdaResponse: TestExecutionResult = {
        status: ExecutionStatus.SUCCEEDED,
        result: JSON.stringify({ success: true }),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
      );

      expect(testResult.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    });
  });

  describe("getResult with stackTrace", () => {
    it("should set error stack trace when errorFromResult.stackTrace is not undefined", () => {
      const lambdaResponse: TestExecutionResult = {
        status: ExecutionStatus.FAILED,
        result: JSON.stringify({ someField: "value" }),
        error: {
          ErrorMessage: "Test error message",
          ErrorData: "test-data",
          ErrorType: "TestError",
          StackTrace: ["at line 1", "at line 2", "at line 3"],
        },
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
      );

      let thrownError: Error;
      try {
        testResult.getResult();
      } catch (error) {
        thrownError = error as Error;
      }

      expect(thrownError!.message).toBe("Test error message");
      expect(thrownError!.stack).toBe("at line 1\nat line 2\nat line 3");
    });
  });

  describe("getResult error throwing for non-succeeded statuses", () => {
    it.each([
      ExecutionStatus.FAILED,
      ExecutionStatus.RUNNING,
      ExecutionStatus.STOPPED,
      ExecutionStatus.TIMED_OUT,
    ])("should throw an error when status is %s", (status) => {
      const lambdaResponse: TestExecutionResult = {
        status,
        result: JSON.stringify({ someField: "value" }),
        error: {
          ErrorMessage: "Execution failed",
          ErrorData: "error-data",
          ErrorType: "ExecutionError",
          StackTrace: ["stack trace line"],
        },
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
      );

      expect(() => testResult.getResult()).toThrow("Execution failed");
    });
  });

  describe("getError for non-succeeded statuses", () => {
    it.each([
      ExecutionStatus.FAILED,
      ExecutionStatus.RUNNING,
      ExecutionStatus.STOPPED,
      ExecutionStatus.TIMED_OUT,
    ])("should return error for status %s", (status) => {
      const lambdaResponse: TestExecutionResult = {
        status,
        result: JSON.stringify({ someField: "value" }),
        error: {
          ErrorMessage: "Test error message",
          ErrorData: "test-error-data",
          ErrorType: "TestErrorType",
          StackTrace: ["stack line 1", "stack line 2"],
        },
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
      );

      const error = testResult.getError();
      expect(error).toEqual({
        errorMessage: "Test error message",
        errorData: "test-error-data",
        errorType: "TestErrorType",
        stackTrace: ["stack line 1", "stack line 2"],
      });
    });

    it("should return timeout error when status is TIMED_OUT and no error data exists", () => {
      const lambdaResponse: TestExecutionResult = {
        status: ExecutionStatus.TIMED_OUT,
        result: JSON.stringify({ someField: "value" }),
        // No error property - testing the TIMED_OUT specific case
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
      );

      const error = testResult.getError();
      expect(error).toEqual({
        errorMessage: `Execution failed with status "TIMED_OUT"`,
        errorData: undefined,
        errorType: undefined,
        stackTrace: undefined,
      });
    });
  });
});
