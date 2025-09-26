import { ResultFormatter } from "../result-formatter";
import { LocalOperationStorage } from "../operations/local-operation-storage";
import { OperationWaitManager } from "../operations/operation-wait-manager";
import { OperationStatus, OperationType, Event } from "@aws-sdk/client-lambda";
import { OperationWithData } from "../../common/operations/operation-with-data";
import { IndexedOperations } from "../../common/indexed-operations";
import { TestExecutionResult } from "../test-execution-state";

// Mock OperationStorage
jest.mock("../operations/local-operation-storage");

describe("ResultFormatter", () => {
  let resultFormatter: ResultFormatter<{ success: boolean }>;
  let mockOperationStorage: jest.Mocked<LocalOperationStorage>;
  let mockWaitManager: OperationWaitManager;
  let mockOperationIndex: IndexedOperations;

  beforeEach(() => {
    mockOperationIndex = new IndexedOperations([]);
    mockOperationStorage = new LocalOperationStorage(
      new OperationWaitManager(),
      mockOperationIndex,
      jest.fn()
    ) as jest.Mocked<LocalOperationStorage>;
    resultFormatter = new ResultFormatter<{ success: boolean }>();
    mockWaitManager = new OperationWaitManager();
  });

  describe("formatTestResult", () => {
    it("should format a successful lambda response with JSON data", () => {
      const mockOperations = [
        new OperationWithData(mockWaitManager, mockOperationIndex, {
          operation: {
            Id: "op1",
            Name: "operation1",
            Type: OperationType.STEP,
            Status: OperationStatus.SUCCEEDED,
          },
          events: [],
        }),
      ];

      mockOperationStorage.getOperations.mockReturnValue(mockOperations);

      const lambdaResponse: TestExecutionResult = {
        status: OperationStatus.SUCCEEDED,
        result: JSON.stringify({ success: true }),
      };

      // Create mock invocations
      const mockInvocations = [
        { id: "inv-1", getOperations: jest.fn() },
        { id: "inv-2", getOperations: jest.fn() },
      ];

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
        mockInvocations
      );

      expect(testResult.getOperations()).toEqual(mockOperations);
      expect(testResult.getInvocations()).toEqual(mockInvocations);
      expect(testResult.getResult()).toEqual({
        success: true,
      });
    });

    it("should filter operations by status when params are provided", () => {
      // Create mock operations with different statuses
      const succeededOp = new OperationWithData(
        mockWaitManager,
        mockOperationIndex,
        {
          operation: {
            Id: "op1",
            Name: "succeededOp",
            Type: OperationType.STEP,
            Status: OperationStatus.SUCCEEDED,
          },
          events: [],
        }
      );

      const failedOp = new OperationWithData(
        mockWaitManager,
        mockOperationIndex,
        {
          operation: {
            Id: "op2",
            Name: "failedOp",
            Type: OperationType.STEP,
            Status: OperationStatus.FAILED,
          },
          events: [],
        }
      );

      const mockOperations = [succeededOp, failedOp];
      mockOperationStorage.getOperations.mockReturnValue(mockOperations);

      const lambdaResponse: TestExecutionResult = {
        status: OperationStatus.SUCCEEDED,
        result: JSON.stringify({ success: true }),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
        []
      );

      // Test filtering by SUCCEEDED status
      const succeededOps = testResult.getOperations({
        status: OperationStatus.SUCCEEDED,
      });
      expect(succeededOps).toHaveLength(1);
      expect(succeededOps[0].getStatus()).toBe(OperationStatus.SUCCEEDED);

      // Test filtering by FAILED status
      const failedOps = testResult.getOperations({
        status: OperationStatus.FAILED,
      });
      expect(failedOps).toHaveLength(1);
      expect(failedOps[0].getStatus()).toBe(OperationStatus.FAILED);
    });

    it("should pass invocations from parameters to test result", () => {
      mockOperationStorage.getOperations.mockReturnValue([]);

      const lambdaResponse: TestExecutionResult = {
        status: OperationStatus.SUCCEEDED,
        result: JSON.stringify({ success: true }),
      };

      const mockInvocations = [
        {
          id: "inv-1",
          getOperations: jest.fn().mockReturnValue([]),
        },
        {
          id: "inv-2",
          getOperations: jest.fn().mockReturnValue([]),
        },
        {
          id: "inv-3",
          getOperations: jest.fn().mockReturnValue([]),
        },
      ];

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
        mockInvocations
      );

      const returnedInvocations = testResult.getInvocations();
      expect(returnedInvocations).toEqual(mockInvocations);
      expect(returnedInvocations).toHaveLength(3);
      expect(returnedInvocations[0].id).toBe("inv-1");
      expect(returnedInvocations[1].id).toBe("inv-2");
      expect(returnedInvocations[2].id).toBe("inv-3");
    });

    it("should handle undefined value", () => {
      mockOperationStorage.getOperations.mockReturnValue([]);

      const lambdaResponse: TestExecutionResult = {
        status: OperationStatus.SUCCEEDED,
        result: "",
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
        []
      );

      expect(testResult.getResult()).toEqual("");
    });

    it("should handle non-JSON value by returning raw value", () => {
      mockOperationStorage.getOperations.mockReturnValue([]);

      const lambdaResponse: TestExecutionResult = {
        status: OperationStatus.SUCCEEDED,
        result: "raw-string-value",
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
        []
      );

      expect(testResult.getResult()).toEqual("raw-string-value");
    });

    it("should handle invalid JSON by returning raw value", () => {
      mockOperationStorage.getOperations.mockReturnValue([]);

      const lambdaResponse: TestExecutionResult = {
        status: OperationStatus.SUCCEEDED,
        result: "{ invalid json",
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
        []
      );

      expect(testResult.getResult()).toEqual("{ invalid json");
    });

    it("should return operations from operation storage", () => {
      const mockOperations = [
        {
          operation: {
            Id: "op1",
            Name: "operation1",
            Status: OperationStatus.SUCCEEDED,
            Type: OperationType.STEP,
          },
          update: {},
          events: [],
        },
        {
          operation: {
            Id: "op2",
            Name: "operation2",
            Status: OperationStatus.SUCCEEDED,
            Type: OperationType.WAIT,
          },
          update: {},
          events: [],
        },
      ].map(
        (checkpointOperation) =>
          new OperationWithData(
            mockWaitManager,
            mockOperationIndex,
            checkpointOperation
          )
      );

      mockOperationStorage.getOperations.mockReturnValue(mockOperations);

      const lambdaResponse: TestExecutionResult = {
        status: OperationStatus.SUCCEEDED,
        result: JSON.stringify({ success: true }),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
        []
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
        status: OperationStatus.SUCCEEDED,
        result: JSON.stringify(complexData),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
        []
      );

      expect(testResult.getResult()).toEqual(complexData);
    });

    it("should throw Error with 'Execution failed' when ErrorMessage is empty string", () => {
      const lambdaResponse: TestExecutionResult = {
        status: OperationStatus.FAILED,
        result: JSON.stringify({ error: "" }),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
        []
      );

      expect(() => testResult.getResult()).toThrow("Execution failed");
    });

    it("should clean stack trace by removing ResultFormatter references", () => {
      const lambdaResponse: TestExecutionResult = {
        status: OperationStatus.FAILED,
        result: JSON.stringify({ error: "Test error" }),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
        []
      );

      let thrownError: Error;
      try {
        testResult.getResult();
      } catch (error) {
        thrownError = error as Error;
      }

      // The stack should be cleaned to remove ResultFormatter references
      expect(thrownError!.stack).toBeDefined();
      expect(thrownError!.stack).not.toContain("ResultFormatter");
    });
  });

  describe("getError behavior", () => {
    it("should return ErrorObject for failed invocation", () => {
      const mockError = "Handler execution failed";

      const lambdaResponse: TestExecutionResult = {
        status: OperationStatus.FAILED,
        result: JSON.stringify({ error: mockError }),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
        []
      );

      expect(testResult.getError()).toEqual({
        errorMessage: mockError,
      });
    });

    it("should throw error when called on successful execution", () => {
      const lambdaResponse: TestExecutionResult = {
        status: OperationStatus.SUCCEEDED,
        result: JSON.stringify({ success: true }),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
        []
      );

      expect(() => testResult.getError()).toThrow(
        "Cannot get error for succeeded execution"
      );
    });

    it("should throw error when parsing fails", () => {
      const lambdaResponse: TestExecutionResult = {
        status: OperationStatus.FAILED,
        result: "Raw error message - not JSON",
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
        []
      );

      expect(() => testResult.getError()).toThrow(
        "Could not find error result"
      );
    });

    it("should throw error when error field is not a string", () => {
      const lambdaResponse: TestExecutionResult = {
        status: OperationStatus.FAILED,
        result: JSON.stringify({ error: { nested: "object" } }),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
        []
      );

      expect(() => testResult.getError()).toThrow(
        "Could not find error result"
      );
    });

    it("should return ErrorObject when error object is specified", () => {
      const lambdaResponse: TestExecutionResult = {
        status: OperationStatus.FAILED,
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
        []
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
        status: OperationStatus.SUCCEEDED,
        result: JSON.stringify({ success: true }),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        mockEvents,
        mockOperationStorage,
        []
      );

      expect(testResult.getHistoryEvents()).toEqual(mockEvents);
    });

    it("should return empty array when no events provided", () => {
      mockOperationStorage.getOperations.mockReturnValue([]);

      const lambdaResponse: TestExecutionResult = {
        status: OperationStatus.SUCCEEDED,
        result: JSON.stringify({ success: true }),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
        []
      );

      expect(testResult.getHistoryEvents()).toEqual([]);
    });
  });

  describe("getStatus", () => {
    it("should return status from lambda response", () => {
      mockOperationStorage.getOperations.mockReturnValue([]);

      const lambdaResponse: TestExecutionResult = {
        status: OperationStatus.SUCCEEDED,
        result: JSON.stringify({ success: true }),
      };

      const testResult = resultFormatter.formatTestResult(
        lambdaResponse,
        [],
        mockOperationStorage,
        []
      );

      expect(testResult.getStatus()).toBe(OperationStatus.SUCCEEDED);
    });
  });
});
