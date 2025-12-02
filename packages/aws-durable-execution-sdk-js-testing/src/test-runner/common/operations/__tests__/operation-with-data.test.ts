import {
  OperationStatus,
  OperationType,
  ErrorObject,
  Operation,
} from "@aws-sdk/client-lambda";
import { OperationSubType } from "@aws/durable-execution-sdk-js";

import { WaitingOperationStatus } from "../../../types/durable-operation";
import { OperationWaitManager } from "../../../local/operations/operation-wait-manager";
import { OperationEvents, OperationWithData } from "../operation-with-data";
import { IndexedOperations } from "../../indexed-operations";
import { DurableApiClient } from "../../create-durable-api-client";

describe("OperationWithData", () => {
  const mockIndexedOperations = new IndexedOperations([]);
  const waitManager = new OperationWaitManager(mockIndexedOperations);
  const mockApiClient: jest.Mocked<DurableApiClient> = {
    sendCallbackSuccess: jest.fn(),
    sendCallbackFailure: jest.fn(),
    sendCallbackHeartbeat: jest.fn(),
  };
  jest.spyOn(waitManager, "waitForOperation");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("data", () => {
    it("should return undefined when operation data is not populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );

      expect(operation.getOperationData()).toBeUndefined();
    });

    it("should return operation data when populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Status: OperationStatus.SUCCEEDED,
        Type: undefined,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(operation.getOperationData()).toStrictEqual(operationData);
    });
  });

  describe("getContextDetails", () => {
    it("should throw error when operation type is not CONTEXT", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.STEP,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(() => operation.getContextDetails()).toThrow(
        "Operation type STEP is not CONTEXT",
      );
    });

    it("should return context details when operation type is CONTEXT", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-context",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.CONTEXT,
        ContextDetails: {
          Result: '{"success": true, "data": "test-data"}',
          Error: {
            ErrorMessage: "Context warning",
            ErrorType: "ContextWarning",
          },
        },
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      const contextDetails = operation.getContextDetails();
      expect(contextDetails).toEqual({
        result: { success: true, data: "test-data" },
        error: {
          errorMessage: "Context warning",
          errorType: "ContextWarning",
        },
      });
    });

    it("should return context details with only result", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-context",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.CONTEXT,
        ContextDetails: {
          Result: '{"userId": 123, "name": "John Doe"}',
          Error: undefined,
        },
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      const contextDetails = operation.getContextDetails();
      expect(contextDetails).toEqual({
        result: { userId: 123, name: "John Doe" },
        error: undefined,
      });
    });

    it("should return context details with only error", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-context",
        Status: OperationStatus.FAILED,
        Type: OperationType.CONTEXT,
        ContextDetails: {
          Result: undefined,
          Error: {
            ErrorMessage: "Context execution failed",
            ErrorType: "ContextExecutionError",
          },
        },
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      const contextDetails = operation.getContextDetails();
      expect(contextDetails).toEqual({
        result: undefined,
        error: {
          errorMessage: "Context execution failed",
          errorType: "ContextExecutionError",
        },
      });
    });

    it("should handle unparseable JSON in Result field", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-context",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.CONTEXT,
        ContextDetails: {
          Result: "invalid-json{",
          Error: undefined,
        },
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      const contextDetails = operation.getContextDetails();
      expect(contextDetails).toEqual({
        result: "invalid-json{", // Should return the raw string when JSON parsing fails
        error: undefined,
      });
    });

    it("should return undefined when no data is populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const contextDetails = operation.getContextDetails();
      expect(contextDetails).toBeUndefined();
    });

    it("should handle missing ContextDetails", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-context",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.CONTEXT,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      const contextDetails = operation.getContextDetails();
      expect(contextDetails).toEqual({
        result: undefined,
        error: undefined,
      });
    });
  });

  describe("getStepDetails", () => {
    it("should throw error when operation type is not STEP", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.CALLBACK,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(() => operation.getStepDetails()).toThrow(
        "Operation type CALLBACK is not STEP",
      );
    });

    it("should return step details when operation type is STEP", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-step",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.STEP,
        StepDetails: {
          Attempt: 1,
          NextAttemptTimestamp: new Date("2023-01-01"),
          Result: '{"success": true}',
          Error: undefined,
        },
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      const stepDetails = operation.getStepDetails();
      expect(stepDetails).toEqual({
        attempt: 1,
        nextAttemptTimestamp: new Date("2023-01-01"),
        result: { success: true },
        error: undefined,
      });
    });

    it("should return undefined when no data is populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const stepDetails = operation.getStepDetails();
      expect(stepDetails).toBeUndefined();
    });

    it("should return step details with error when populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "step-op-error",
        Type: OperationType.STEP,
        Status: OperationStatus.FAILED,
        StepDetails: {
          Attempt: 1,
          Result: undefined,
          Error: {
            ErrorMessage: "Step execution failed",
            ErrorType: "StepError",
          },
        },
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      const result = operation.getStepDetails();

      expect(result).toEqual({
        attempt: 1,
        nextAttemptTimestamp: undefined,
        result: undefined,
        error: {
          errorMessage: "Step execution failed",
          errorType: "StepError",
        },
      });
    });

    it("should return step details with both result and error", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "step-op-partial",
        Type: OperationType.STEP,
        Status: OperationStatus.FAILED,
        StepDetails: {
          Attempt: 2,
          Result: '{"partial": "data"}',
          Error: {
            ErrorMessage: "Partial failure occurred",
            ErrorType: "PartialFailure",
          },
        },
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      const result = operation.getStepDetails();

      expect(result).toEqual({
        attempt: 2,
        nextAttemptTimestamp: undefined,
        result: { partial: "data" },
        error: {
          errorMessage: "Partial failure occurred",
          errorType: "PartialFailure",
        },
      });
    });

    it("should handle unparseable JSON in Result field with error", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "step-op-bad-json",
        Type: OperationType.STEP,
        Status: OperationStatus.FAILED,
        StepDetails: {
          Attempt: 1,
          Result: "invalid-json{",
          Error: {
            ErrorMessage: "JSON parsing failed",
            ErrorType: "ParseError",
          },
        },
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      const result = operation.getStepDetails();

      expect(result).toEqual({
        attempt: 1,
        nextAttemptTimestamp: undefined,
        result: "invalid-json{", // Should return the raw string when JSON parsing fails
        error: {
          errorMessage: "JSON parsing failed",
          errorType: "ParseError",
        },
      });
    });

    it("should handle missing StepDetails with default values", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "step-op-no-details",
        Type: OperationType.STEP,
        Status: OperationStatus.STARTED,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      const result = operation.getStepDetails();

      expect(result).toEqual({
        attempt: undefined,
        nextAttemptTimestamp: undefined,
        result: undefined,
        error: undefined,
      });
    });
  });

  describe("getCallbackDetails", () => {
    it("should throw error when operation type is not CALLBACK", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.STEP,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(() => operation.getCallbackDetails()).toThrow(
        "Operation with Type STEP and SubType undefined is not a valid callback",
      );
    });

    it("should throw error when CallbackId is undefined", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-callback",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.CALLBACK,
        CallbackDetails: {
          CallbackId: undefined,
        },
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(() => operation.getCallbackDetails()).toThrow(
        "Could not find callback ID in callback details",
      );
    });

    it("should return callback details when properly configured", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-callback",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.CALLBACK,
        CallbackDetails: {
          CallbackId: "callback-123",
          Result: '{"data": "test"}',
          Error: { ErrorMessage: "Test error" },
        },
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      const callbackDetails = operation.getCallbackDetails();
      expect(callbackDetails).toEqual({
        callbackId: "callback-123",
        result: { data: "test" },
        error: { errorMessage: "Test error" },
      });
    });

    it("should return undefined when no data is populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const callbackDetails = operation.getCallbackDetails();
      expect(callbackDetails).toBeUndefined();
    });

    it("should return callback details for WAIT_FOR_CALLBACK context operation with child CALLBACK", () => {
      const mockChildOperations: OperationEvents[] = [
        {
          operation: {
            Id: "child-callback",
            Name: "child-callback-op",
            Type: OperationType.CALLBACK,
            CallbackDetails: {
              CallbackId: "callback-456",
              Result: '{"waitResult": "success"}',
              Error: { ErrorMessage: "Wait callback error" },
            },
            StartTimestamp: undefined,
            Status: undefined,
          },
          events: [],
        },
      ];

      // Mock the getOperationChildren method
      jest
        .spyOn(mockIndexedOperations, "getOperationChildren")
        .mockReturnValue(mockChildOperations);

      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "wait-for-callback-op",
        Name: "wait-for-callback",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.CONTEXT,
        SubType: OperationSubType.WAIT_FOR_CALLBACK,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      const callbackDetails = operation.getCallbackDetails();
      expect(callbackDetails).toEqual({
        callbackId: "callback-456",
        result: { waitResult: "success" },
        error: { errorMessage: "Wait callback error" },
      });
    });

    it("should throw error when WAIT_FOR_CALLBACK context has no child CALLBACK operation", () => {
      const mockChildOperations: OperationEvents[] = [
        {
          operation: {
            Id: "child-step",
            Name: "child-step-op",
            Type: OperationType.STEP,
            StartTimestamp: undefined,
            Status: undefined,
          },
          events: [],
        },
      ];

      // Mock the getOperationChildren method
      jest
        .spyOn(mockIndexedOperations, "getOperationChildren")
        .mockReturnValue(mockChildOperations);

      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "wait-for-callback-op",
        Name: "wait-for-callback",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.CONTEXT,
        SubType: OperationSubType.WAIT_FOR_CALLBACK,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(() => operation.getCallbackDetails()).toThrow(
        "Could not find CALLBACK operation in WAIT_FOR_CALLBACK context",
      );
    });

    it("should throw error when WAIT_FOR_CALLBACK context has empty child operations", () => {
      // Mock the getOperationChildren method to return empty array
      jest
        .spyOn(mockIndexedOperations, "getOperationChildren")
        .mockReturnValue([]);

      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "wait-for-callback-op",
        Name: "wait-for-callback",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.CONTEXT,
        SubType: OperationSubType.WAIT_FOR_CALLBACK,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(() => operation.getCallbackDetails()).toThrow(
        "Could not find CALLBACK operation in WAIT_FOR_CALLBACK context",
      );
    });

    it("should throw error when WAIT_FOR_CALLBACK child CALLBACK operation has undefined CallbackId", () => {
      const mockChildOperations: OperationEvents[] = [
        {
          operation: {
            Id: "child-callback",
            Name: "child-callback-op",
            Type: OperationType.CALLBACK,
            CallbackDetails: {
              CallbackId: undefined, // Missing CallbackId
            },
            StartTimestamp: undefined,
            Status: undefined,
          },
          events: [],
        },
      ];

      // Mock the getOperationChildren method
      jest
        .spyOn(mockIndexedOperations, "getOperationChildren")
        .mockReturnValue(mockChildOperations);

      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "wait-for-callback-op",
        Name: "wait-for-callback",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.CONTEXT,
        SubType: OperationSubType.WAIT_FOR_CALLBACK,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(() => operation.getCallbackDetails()).toThrow(
        "Could not find callback ID in callback details",
      );
    });
  });

  describe("getChainedInvokeDetails", () => {
    it("should throw error when operation type is not INVOKE", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.STEP,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(() => operation.getChainedInvokeDetails()).toThrow(
        "Operation type STEP is not INVOKE",
      );
    });

    it("should return invoke details with only result", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-invoke",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.CHAINED_INVOKE,
        ChainedInvokeDetails: {
          Result: '{"functionResult": "success", "executionTime": 250}',
          Error: undefined,
        },
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      const invokeDetails = operation.getChainedInvokeDetails();
      expect(invokeDetails).toEqual({
        result: { functionResult: "success", executionTime: 250 },
        error: undefined,
      });
    });

    it("should return invoke details with only error", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-invoke",
        Status: OperationStatus.FAILED,
        Type: OperationType.CHAINED_INVOKE,
        ChainedInvokeDetails: {
          Result: undefined,
          Error: {
            ErrorMessage: "Function invocation failed",
            ErrorType: "InvocationError",
            StackTrace: ["Error at line 1", "Error at line 2"],
          },
        },
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      const invokeDetails = operation.getChainedInvokeDetails();
      expect(invokeDetails).toEqual({
        result: undefined,
        error: {
          errorMessage: "Function invocation failed",
          errorType: "InvocationError",
          stackTrace: ["Error at line 1", "Error at line 2"],
        },
      });
    });

    it("should not handle unparseable JSON in Result field", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-invoke",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.CHAINED_INVOKE,
        ChainedInvokeDetails: {
          Result: "invalid-json{",
          Error: undefined,
        },
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(() => operation.getChainedInvokeDetails()).toThrow(
        "Could not parse result for invoke details",
      );
    });

    it("should return undefined when no data is populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const invokeDetails = operation.getChainedInvokeDetails();
      expect(invokeDetails).toBeUndefined();
    });

    it("should handle missing ChainedInvokeDetails", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-invoke",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.CHAINED_INVOKE,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      const invokeDetails = operation.getChainedInvokeDetails();
      expect(invokeDetails).toEqual({
        result: undefined,
        error: undefined,
      });
    });
  });

  describe("getWaitDetails", () => {
    it("should throw error when operation type is not WAIT", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.STEP,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(() => operation.getWaitDetails()).toThrow(
        "Operation type STEP is not WAIT",
      );
    });

    it("should return wait details when operation type is WAIT", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-wait",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.WAIT,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [
          {
            WaitStartedDetails: {
              Duration: 30,
              ScheduledEndTimestamp: new Date("2025-09-10T22:53:25.217Z"),
            },
          },
          {
            WaitSucceededDetails: {
              Duration: 30,
            },
          },
        ],
      });

      const waitDetails = operation.getWaitDetails();
      expect(waitDetails).toEqual({
        waitSeconds: 30,
        scheduledEndTimestamp: new Date("2025-09-10T22:53:25.217Z"),
      });
    });

    it("should return undefined when no data is populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const waitDetails = operation.getWaitDetails();
      expect(waitDetails).toBeUndefined();
    });
  });

  describe("getter methods", () => {
    it("should return id when data is populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-operation-id",
        Name: "test-operation-name",
        Status: OperationStatus.SUCCEEDED,
        Type: undefined,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(operation.getId()).toBe("test-operation-id");
    });

    it("should return undefined for id when data is not populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      expect(operation.getId()).toBeUndefined();
    });

    it("should return name when data is populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-operation-name",
        Status: OperationStatus.SUCCEEDED,
        Type: undefined,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(operation.getName()).toBe("test-operation-name");
    });

    it("should return undefined for name when data is not populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      expect(operation.getName()).toBeUndefined();
    });

    it("should return type when data is populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.STEP,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(operation.getType()).toBe(OperationType.STEP);
    });

    it("should return undefined for type when data is not populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      expect(operation.getType()).toBeUndefined();
    });

    it("should return status when data is populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Status: OperationStatus.SUCCEEDED,
        Type: undefined,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(operation.getStatus()).toBe(OperationStatus.SUCCEEDED);
    });

    it("should return undefined for status when data is not populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      expect(operation.getStatus()).toBeUndefined();
    });

    it("should return start timestamp when data is populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const startTime = new Date("2023-01-01T10:00:00Z");
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Status: OperationStatus.SUCCEEDED,
        StartTimestamp: startTime,
        Type: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(operation.getStartTimestamp()).toBe(startTime);
    });

    it("should return undefined for start timestamp when data is not populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      expect(operation.getStartTimestamp()).toBeUndefined();
    });

    it("should return end timestamp when data is populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const endTime = new Date("2023-01-01T11:00:00Z");
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Status: OperationStatus.SUCCEEDED,
        EndTimestamp: endTime,
        Type: undefined,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(operation.getEndTimestamp()).toBe(endTime);
    });

    it("should return undefined for end timestamp when data is not populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      expect(operation.getEndTimestamp()).toBeUndefined();
    });

    it("should return parent ID when data is populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Status: OperationStatus.SUCCEEDED,
        ParentId: "parent-123",
        Type: undefined,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(operation.getParentId()).toBe("parent-123");
    });

    it("should return undefined for parent ID when data is not populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      expect(operation.getParentId()).toBeUndefined();
    });

    it("should return subtype when data is populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.CONTEXT,
        SubType: OperationSubType.WAIT_FOR_CALLBACK,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(operation.getSubType()).toBe(OperationSubType.WAIT_FOR_CALLBACK);
    });

    it("should return undefined for subtype when data is not populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      expect(operation.getSubType()).toBeUndefined();
    });

    it("should return true for isWaitForCallback when operation is CONTEXT with WAIT_FOR_CALLBACK subtype", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.CONTEXT,
        SubType: OperationSubType.WAIT_FOR_CALLBACK,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(operation.isWaitForCallback()).toBe(true);
    });

    it("should return false for isWaitForCallback when operation is not WAIT_FOR_CALLBACK", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.STEP,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(operation.isWaitForCallback()).toBe(false);
    });

    it("should return true for isCallback when operation type is CALLBACK", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.CALLBACK,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(operation.isCallback()).toBe(true);
    });

    it("should return false for isCallback when operation type is not CALLBACK", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.STEP,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      expect(operation.isCallback()).toBe(false);
    });
  });

  describe("callback methods", () => {
    describe("getCallbackId", () => {
      it("should throw error when operation has not run yet", () => {
        const operation = new OperationWithData(
          waitManager,
          mockIndexedOperations,
          mockApiClient,
        );

        expect(() => operation.sendCallbackSuccess("test-result")).toThrow(
          "Could not find callback details",
        );
      });

      it("should throw error when operation type is not CALLBACK", () => {
        const operation = new OperationWithData(
          waitManager,
          mockIndexedOperations,
          mockApiClient,
        );
        const operationData: Operation = {
          Id: "test-id",
          Name: "callback-op",
          Status: OperationStatus.SUCCEEDED,
          Type: OperationType.STEP,
          StartTimestamp: undefined,
        };

        operation.populateData({
          operation: operationData,
          events: [],
        });

        expect(() => operation.sendCallbackSuccess("test-result")).toThrow(
          "Operation with Type STEP and SubType undefined is not a valid callback",
        );
      });

      it("should throw error when CallbackDetails is missing", () => {
        const operation = new OperationWithData(
          waitManager,
          mockIndexedOperations,
          mockApiClient,
        );
        const operationData: Operation = {
          Id: "test-id",
          Name: "callback-op",
          Status: OperationStatus.SUCCEEDED,
          Type: OperationType.CALLBACK,
          StartTimestamp: undefined,
        };

        operation.populateData({
          operation: operationData,
          events: [],
        });

        expect(() => operation.sendCallbackSuccess("test-result")).toThrow(
          "Could not find callback ID in callback details",
        );
      });

      it("should throw error when CallbackDetails.CallbackId is undefined", () => {
        const operation = new OperationWithData(
          waitManager,
          mockIndexedOperations,
          mockApiClient,
        );
        const operationData: Operation = {
          Id: "test-id",
          Name: "callback-op",
          Status: OperationStatus.SUCCEEDED,
          Type: OperationType.CALLBACK,
          CallbackDetails: {
            // CallbackId is undefined
          },
          StartTimestamp: undefined,
        };

        operation.populateData({
          operation: operationData,
          events: [],
        });

        expect(() => operation.sendCallbackSuccess("test-result")).toThrow(
          "Could not find callback ID in callback details",
        );
      });
    });

    describe("sendCallbackSuccess", () => {
      it("should send success callback with correct parameters", async () => {
        const operation = new OperationWithData(
          waitManager,
          mockIndexedOperations,
          mockApiClient,
        );
        const operationData: Operation = {
          Id: "test-id",
          Name: "callback-op",
          Status: OperationStatus.SUCCEEDED,
          Type: OperationType.CALLBACK,
          CallbackDetails: {
            CallbackId: "callback-123",
          },
          StartTimestamp: undefined,
        };

        operation.populateData({
          operation: operationData,
          events: [],
        });
        mockApiClient.sendCallbackSuccess.mockResolvedValue({
          $metadata: {},
        });

        const result = await operation.sendCallbackSuccess("test-result");

        expect(mockApiClient.sendCallbackSuccess).toHaveBeenCalledWith({
          Result: Buffer.from("test-result"),
          CallbackId: "callback-123",
        });
        expect(result).toEqual({
          $metadata: {},
        });
      });

      it("should handle client errors", async () => {
        const operation = new OperationWithData(
          waitManager,
          mockIndexedOperations,
          mockApiClient,
        );
        const operationData: Operation = {
          Id: "test-id",
          Name: "callback-op",
          Status: OperationStatus.SUCCEEDED,
          Type: OperationType.CALLBACK,
          CallbackDetails: {
            CallbackId: "callback-123",
          },
          StartTimestamp: undefined,
        };

        operation.populateData({
          operation: operationData,
          events: [],
        });
        const clientError = new Error("Client error");
        mockApiClient.sendCallbackSuccess.mockRejectedValue(clientError);

        await expect(
          operation.sendCallbackSuccess("test-result"),
        ).rejects.toThrow("Client error");
      });
    });

    describe("sendCallbackFailure", () => {
      it("should send failure callback with correct parameters", async () => {
        const operation = new OperationWithData(
          waitManager,
          mockIndexedOperations,
          mockApiClient,
        );
        const operationData: Operation = {
          Id: "test-id",
          Name: "callback-op",
          Status: OperationStatus.SUCCEEDED,
          Type: OperationType.CALLBACK,
          CallbackDetails: {
            CallbackId: "callback-456",
          },
          StartTimestamp: undefined,
        };

        operation.populateData({
          operation: operationData,
          events: [],
        });
        mockApiClient.sendCallbackFailure.mockResolvedValue({
          $metadata: {},
        });

        const errorObject: ErrorObject = {
          ErrorMessage: "Test error",
          ErrorType: "TestError",
        };

        const result = await operation.sendCallbackFailure(errorObject);

        expect(mockApiClient.sendCallbackFailure).toHaveBeenCalledWith({
          Error: errorObject,
          CallbackId: "callback-456",
        });
        expect(result).toEqual({ $metadata: {} });
      });

      it("should handle client errors", async () => {
        const operation = new OperationWithData(
          waitManager,
          mockIndexedOperations,
          mockApiClient,
        );
        const operationData: Operation = {
          Id: "test-id",
          Name: "callback-op",
          Status: OperationStatus.SUCCEEDED,
          Type: OperationType.CALLBACK,
          CallbackDetails: {
            CallbackId: "callback-123",
          },
          StartTimestamp: undefined,
        };

        operation.populateData({
          operation: operationData,
          events: [],
        });
        const clientError = new Error("Client failure error");
        mockApiClient.sendCallbackFailure.mockRejectedValue(clientError);

        const errorObject: ErrorObject = {
          ErrorMessage: "Test error",
        };

        await expect(
          operation.sendCallbackFailure(errorObject),
        ).rejects.toThrow("Client failure error");
      });
    });

    describe("sendCallbackHeartbeat", () => {
      it("should send heartbeat with correct parameters", async () => {
        const operation = new OperationWithData(
          waitManager,
          mockIndexedOperations,
          mockApiClient,
        );
        const operationData: Operation = {
          Id: "test-id",
          Name: "callback-op",
          Status: OperationStatus.SUCCEEDED,
          Type: OperationType.CALLBACK,
          CallbackDetails: {
            CallbackId: "callback-heartbeat-123",
          },
          StartTimestamp: undefined,
        };

        operation.populateData({
          operation: operationData,
          events: [],
        });
        mockApiClient.sendCallbackHeartbeat.mockResolvedValue({
          $metadata: {},
        });

        const result = await operation.sendCallbackHeartbeat();

        expect(mockApiClient.sendCallbackHeartbeat).toHaveBeenCalledWith({
          CallbackId: "callback-heartbeat-123",
        });
        expect(result).toEqual({ $metadata: {} });
      });

      it("should handle client errors", async () => {
        const operation = new OperationWithData(
          waitManager,
          mockIndexedOperations,
          mockApiClient,
        );
        const operationData: Operation = {
          Id: "test-id",
          Name: "callback-op",
          Status: OperationStatus.SUCCEEDED,
          Type: OperationType.CALLBACK,
          CallbackDetails: {
            CallbackId: "callback-123",
          },
          StartTimestamp: undefined,
        };

        operation.populateData({
          operation: operationData,
          events: [],
        });
        const clientError = new Error("Heartbeat client error");
        mockApiClient.sendCallbackHeartbeat.mockRejectedValue(clientError);

        await expect(operation.sendCallbackHeartbeat()).rejects.toThrow(
          "Heartbeat client error",
        );
      });
    });

    describe("callback method integration", () => {
      it("should work with different callback operations", async () => {
        const operation1 = new OperationWithData(
          waitManager,
          mockIndexedOperations,
          mockApiClient,
        );
        const operation2 = new OperationWithData(
          waitManager,
          mockIndexedOperations,
          mockApiClient,
        );

        const operationData1: Operation = {
          Id: "test-id-1",
          Name: "callback-1",
          Status: OperationStatus.SUCCEEDED,
          Type: OperationType.CALLBACK,
          CallbackDetails: {
            CallbackId: "callback-id-1",
          },
          StartTimestamp: undefined,
        };

        const operationData2: Operation = {
          Id: "test-id-2",
          Name: "callback-2",
          Status: OperationStatus.SUCCEEDED,
          Type: OperationType.CALLBACK,
          CallbackDetails: {
            CallbackId: "callback-id-2",
          },
          StartTimestamp: undefined,
        };

        operation1.populateData({
          operation: operationData1,
          events: [],
        });
        operation2.populateData({
          operation: operationData2,
          events: [],
        });

        mockApiClient.sendCallbackSuccess.mockResolvedValue({ $metadata: {} });

        await operation1.sendCallbackSuccess("result-1");
        await operation2.sendCallbackSuccess("result-2");

        expect(mockApiClient.sendCallbackSuccess).toHaveBeenCalledTimes(2);
        expect(mockApiClient.sendCallbackSuccess).toHaveBeenNthCalledWith(1, {
          Result: Buffer.from("result-1"),
          CallbackId: "callback-id-1",
        });
        expect(mockApiClient.sendCallbackSuccess).toHaveBeenNthCalledWith(2, {
          Result: Buffer.from("result-2"),
          CallbackId: "callback-id-2",
        });
      });
    });
  });

  describe("waitFor", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should return data immediately when status matches STARTED", async () => {
      const mockOperation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const expectedResult: OperationEvents = {
        operation: {
          Status: OperationStatus.STARTED,
          Id: undefined,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      };

      // Populate data first with STARTED status
      mockOperation.populateData(expectedResult);

      // waitForData should return immediately for STARTED status
      const result = await mockOperation.waitForData(
        WaitingOperationStatus.STARTED,
      );

      expect(waitManager.waitForOperation).not.toHaveBeenCalled();
      expect(result.getOperationData()).toBe(expectedResult.operation);
    });

    it("should return data immediately when status matches COMPLETED", async () => {
      const mockOperation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const expectedResult: OperationEvents = {
        operation: {
          Status: OperationStatus.SUCCEEDED,
          Id: undefined,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      };

      // Populate data first with SUCCEEDED status (which is COMPLETED)
      mockOperation.populateData(expectedResult);

      // waitForData should return immediately for COMPLETED status
      const result = await mockOperation.waitForData(
        WaitingOperationStatus.COMPLETED,
      );

      expect(waitManager.waitForOperation).not.toHaveBeenCalled();
      expect(result.getOperationData()).toBe(expectedResult.operation);
    });

    it("should wait when data exists but status doesn't match", async () => {
      const mockOperation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const initialData: OperationEvents = {
        operation: {
          Status: OperationStatus.STARTED,
          Id: undefined,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      };
      const finalData: OperationEvents = {
        operation: {
          Status: OperationStatus.SUCCEEDED,
          Id: undefined,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      };

      // Populate with STARTED status initially
      mockOperation.populateData(initialData);

      // Mock wait manager to eventually update to SUCCEEDED status
      (waitManager.waitForOperation as jest.Mock).mockImplementation(() => {
        mockOperation.populateData(finalData);
        return Promise.resolve(mockOperation);
      });

      // Request COMPLETED status - should wait because current status is STARTED
      const result = await mockOperation.waitForData(
        WaitingOperationStatus.COMPLETED,
      );

      expect(waitManager.waitForOperation).toHaveBeenCalledWith(
        mockOperation,
        WaitingOperationStatus.COMPLETED,
      );
      expect(result.getOperationData()).toBe(finalData.operation);
    });

    it("should wait when data exists but has no status", async () => {
      const mockOperation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const initialData: OperationEvents = {
        operation: {
          Id: "test-id",
          Name: "test-operation",
          Type: undefined,
          StartTimestamp: undefined,
          Status: undefined,
        },
        events: [],
      };
      const finalData: OperationEvents = {
        operation: {
          Id: "test-id",
          Name: "test-operation",
          Status: OperationStatus.STARTED,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      };

      // Populate with data that has no status
      mockOperation.populateData(initialData);

      // Mock wait manager to eventually update with status
      (waitManager.waitForOperation as jest.Mock).mockImplementation(() => {
        mockOperation.populateData(finalData);
        return Promise.resolve(mockOperation);
      });

      // Should wait because data has no status (never matches any expected status)
      const result = await mockOperation.waitForData(
        WaitingOperationStatus.STARTED,
      );

      expect(waitManager.waitForOperation).toHaveBeenCalledWith(
        mockOperation,
        WaitingOperationStatus.STARTED,
      );
      expect(result.getOperationData()).toBe(finalData.operation);
    });

    it("should delegate to wait manager with default status when data not available", async () => {
      const mockOperation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      (waitManager.waitForOperation as jest.Mock).mockResolvedValue(
        mockOperation,
      );

      const expectedResult: OperationEvents = {
        operation: {
          Status: OperationStatus.SUCCEEDED,
          Id: undefined,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      };

      // Don't populate data initially - this will trigger wait manager call
      // Mock the wait manager to populate the data when called
      (waitManager.waitForOperation as jest.Mock).mockImplementation(() => {
        mockOperation.populateData(expectedResult);
        return Promise.resolve(mockOperation);
      });

      const result = await mockOperation.waitForData();

      expect(waitManager.waitForOperation).toHaveBeenCalledWith(
        mockOperation,
        WaitingOperationStatus.STARTED, // default status
      );
      expect(result.getOperationData()).toBe(expectedResult.operation);
    });

    it("should delegate to wait manager with specified status when data not available", async () => {
      const mockOperation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      (waitManager.waitForOperation as jest.Mock).mockResolvedValue(
        mockOperation,
      );
      const expectedResult: OperationEvents = {
        operation: {
          Status: OperationStatus.SUCCEEDED,
          Id: undefined,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      };

      // Don't populate data initially - this will trigger wait manager call
      // Mock the wait manager to populate the data when called
      (waitManager.waitForOperation as jest.Mock).mockImplementation(() => {
        mockOperation.populateData(expectedResult);
        return Promise.resolve(mockOperation);
      });

      const result = await mockOperation.waitForData(
        WaitingOperationStatus.COMPLETED,
      );

      expect(waitManager.waitForOperation).toHaveBeenCalledWith(
        mockOperation,
        WaitingOperationStatus.COMPLETED,
      );
      expect(result.getOperationData()).toBe(expectedResult.operation);
    });

    it("should propagate wait manager errors when data not available", async () => {
      const mockOperation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const waitError = new Error("Wait failed");
      (waitManager.waitForOperation as jest.Mock).mockRejectedValue(waitError);

      await expect(mockOperation.waitForData()).rejects.toThrow("Wait failed");
    });

    it("should support multiple concurrent waiters for the same operation", async () => {
      const mockOperation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const expectedResult: OperationEvents = {
        operation: {
          Status: OperationStatus.SUCCEEDED,
          Id: undefined,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      };

      // Mock wait manager to simulate async population
      let resolveWait: () => void;
      const waitPromise = new Promise<OperationWithData>((resolve) => {
        resolveWait = () => {
          mockOperation.populateData(expectedResult);
          resolve(mockOperation);
        };
      });

      (waitManager.waitForOperation as jest.Mock).mockReturnValue(waitPromise);

      // Start multiple waiters
      const waiter1 = mockOperation.waitForData(WaitingOperationStatus.STARTED);
      const waiter2 = mockOperation.waitForData(WaitingOperationStatus.STARTED);
      const waiter3 = mockOperation.waitForData(
        WaitingOperationStatus.COMPLETED,
      );

      // Resolve the wait
      resolveWait!();

      // All waiters should resolve to the same data
      const [result1, result2, result3] = await Promise.all([
        waiter1,
        waiter2,
        waiter3,
      ]);

      expect(result1.getOperationData()).toBe(expectedResult.operation);
      expect(result2.getOperationData()).toBe(expectedResult.operation);
      expect(result3.getOperationData()).toBe(expectedResult.operation);
      expect(waitManager.waitForOperation).toHaveBeenCalledTimes(3);
    });

    it("should handle mixed scenario with some data available and some waiting", async () => {
      const mockOperation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const expectedResult: OperationEvents = {
        operation: {
          Status: OperationStatus.SUCCEEDED,
          Id: undefined,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      };

      // First call - no data, should wait
      (waitManager.waitForOperation as jest.Mock).mockImplementation(() => {
        mockOperation.populateData(expectedResult);
        return Promise.resolve(mockOperation);
      });

      const result1 = await mockOperation.waitForData();
      expect(waitManager.waitForOperation).toHaveBeenCalledTimes(1);
      expect(result1.getOperationData()).toBe(expectedResult.operation);

      // Clear the mock to verify it's not called again
      jest.clearAllMocks();

      // Second call - data already available, should return immediately
      const result2 = await mockOperation.waitForData();
      expect(waitManager.waitForOperation).not.toHaveBeenCalled();
      expect(result2.getOperationData()).toBe(expectedResult.operation);
    });
  });

  describe("getChildOperations", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should return OperationWithData instances for child operations when data is populated", () => {
      const mockChildOperations: OperationEvents[] = [
        {
          operation: {
            Id: "child-1",
            Name: "child-op-1",
            Type: undefined,
            StartTimestamp: undefined,
            Status: undefined,
          },
          events: [],
        },
        {
          operation: {
            Id: "child-2",
            Name: "child-op-2",
            Type: undefined,
            StartTimestamp: undefined,
            Status: undefined,
          },
          events: [],
        },
      ];

      // Mock the getOperationChildren method
      jest
        .spyOn(mockIndexedOperations, "getOperationChildren")
        .mockReturnValue(mockChildOperations);

      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "parent-id",
        Name: "parent-operation",
        Status: OperationStatus.SUCCEEDED,
        Type: undefined,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      const childOperations = operation.getChildOperations();

      expect(mockIndexedOperations.getOperationChildren).toHaveBeenCalledWith(
        "parent-id",
      );
      expect(childOperations).toHaveLength(2);
      expect(childOperations![0]).toBeInstanceOf(OperationWithData);
      expect(childOperations![1]).toBeInstanceOf(OperationWithData);
      expect(childOperations![0].getOperationData()).toEqual({
        Id: "child-1",
        Name: "child-op-1",
      });
      expect(childOperations![1].getOperationData()).toEqual({
        Id: "child-2",
        Name: "child-op-2",
      });
    });

    it("should return undefined when operation data is not populated", () => {
      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );

      const childOperations = operation.getChildOperations();

      expect(childOperations).toBeUndefined();
    });

    it("should return empty array when operation has no children", () => {
      // Mock the getOperationChildren method to return empty array
      jest
        .spyOn(mockIndexedOperations, "getOperationChildren")
        .mockReturnValue([]);

      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "parent-with-no-children",
        Name: "parent-operation",
        Status: OperationStatus.SUCCEEDED,
        Type: undefined,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      const childOperations = operation.getChildOperations();

      expect(mockIndexedOperations.getOperationChildren).toHaveBeenCalledWith(
        "parent-with-no-children",
      );
      expect(childOperations).toEqual([]);
    });

    it("should work with different operation types", () => {
      const mockChildOperations: OperationEvents[] = [
        {
          operation: {
            Id: "step-child",
            Name: "step-child",
            Type: OperationType.STEP,
            StartTimestamp: undefined,
            Status: undefined,
          },
          events: [],
        },
      ];

      jest
        .spyOn(mockIndexedOperations, "getOperationChildren")
        .mockReturnValue(mockChildOperations);

      const operation = new OperationWithData(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const operationData: Operation = {
        Id: "callback-parent",
        Name: "callback-operation",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.CALLBACK,
        StartTimestamp: undefined,
      };

      operation.populateData({
        operation: operationData,
        events: [],
      });

      const childOperations = operation.getChildOperations();

      expect(mockIndexedOperations.getOperationChildren).toHaveBeenCalledWith(
        "callback-parent",
      );
      expect(childOperations).toHaveLength(1);
      expect(childOperations![0]).toBeInstanceOf(OperationWithData);
      expect(childOperations![0].getOperationData()).toEqual({
        Id: "step-child",
        Name: "step-child",
        Type: OperationType.STEP,
      });
    });
  });
});
