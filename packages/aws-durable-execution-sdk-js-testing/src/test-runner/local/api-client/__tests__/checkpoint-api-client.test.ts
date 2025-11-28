import {
  CheckpointServerApiClient,
  SerializedPollCheckpointResponse,
} from "../checkpoint-server-api-client";
import { OperationAction, OperationStatus } from "@aws-sdk/client-lambda";
import {
  API_PATHS,
  HTTP_METHODS,
} from "../../../../checkpoint-server/constants";
import {
  createCheckpointToken,
  createExecutionId,
  createInvocationId,
} from "../../../../checkpoint-server/utils/tagged-strings";
import { SerializedInvocationResult } from "../../../../checkpoint-server/types/serialized-invocation-result";
import { SerializedCheckpointOperation } from "../../../../checkpoint-server/types/operation-event";
import { CheckpointOperation } from "../../../../checkpoint-server/storage/checkpoint-manager";

// Mock the global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("CheckpointApiClient", () => {
  const mockBaseUrl = `http://127.0.0.1:1234`;
  const apiClient = new CheckpointServerApiClient(mockBaseUrl);
  const mockExecutionId = createExecutionId("mock-execution-id");
  const mockOperationId = "mock-operation-id";
  const mockInvocationResultSerialized: SerializedInvocationResult = {
    checkpointToken: createCheckpointToken("mock-token"),
    executionId: mockExecutionId,
    invocationId: createInvocationId("mock-invocation-id"),
    operationEvents: [],
  };
  const fixedTimestamp = new Date("2025-01-01T00:00:00.000Z");
  const mockOperationsSerialized: SerializedCheckpointOperation[] = [
    {
      operation: {
        Id: "op1",
        Type: "STEP",
        StartTimestamp: fixedTimestamp.getTime() / 1000,
        Status: OperationStatus.STARTED,
      },
      update: {
        Id: "op1",
        Type: "STEP",
        Action: OperationAction.START,
      },
      events: [],
    },
  ];
  const mockOperations: CheckpointOperation[] = [
    {
      operation: {
        Id: "op1",
        Type: "STEP",
        StartTimestamp: fixedTimestamp,
        Status: OperationStatus.STARTED,
      },
      update: {
        Id: "op1",
        Type: "STEP",
        Action: OperationAction.START,
      },
      events: [],
    },
  ];

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  describe("startDurableExecution", () => {
    it("should make a POST request to the correct endpoint without payload", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockInvocationResultSerialized),
      });

      const result = await apiClient.startDurableExecution();

      expect(mockFetch).toHaveBeenCalledWith(
        `${mockBaseUrl}${API_PATHS.START_DURABLE_EXECUTION}`,
        {
          method: HTTP_METHODS.POST,
          body: "{}",
          headers: {
            "Content-Type": "application/json",
          },
          signal: undefined,
        },
      );
      expect(result).toEqual(mockInvocationResultSerialized);
    });

    it("should deserialize timestamps from epoch seconds to Date objects", async () => {
      const startTime = new Date("2021-01-01T00:00:00.000Z");
      const endTime = new Date("2021-01-01T00:01:00.000Z");
      const eventTime1 = new Date("2021-01-01T00:00:10.000Z");
      const eventTime2 = new Date("2021-01-01T00:00:50.000Z");

      const serializedResult: SerializedInvocationResult = {
        checkpointToken: createCheckpointToken("mock-token"),
        executionId: mockExecutionId,
        invocationId: createInvocationId("mock-invocation-id"),
        operationEvents: [
          {
            operation: {
              Id: "op-123",
              Name: "TestOperation",
              Type: "STEP",
              Status: OperationStatus.SUCCEEDED,
              StartTimestamp: Math.floor(startTime.getTime() / 1000),
              EndTimestamp: Math.floor(endTime.getTime() / 1000),
              StepDetails: {
                Attempt: 1,
                Result: "test-result",
              },
            },
            events: [
              {
                EventId: 1,
                EventTimestamp: Math.floor(eventTime1.getTime() / 1000),
                EventType: "StepStarted",
                Id: "event-1",
                Name: "Start",
              },
              {
                EventId: 2,
                EventTimestamp: Math.floor(eventTime2.getTime() / 1000),
                EventType: "StepSucceeded",
                Id: "event-2",
                Name: "Success",
              },
            ],
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(serializedResult),
      });

      const result = await apiClient.startDurableExecution();

      expect(result).toEqual({
        checkpointToken: createCheckpointToken("mock-token"),
        executionId: mockExecutionId,
        invocationId: createInvocationId("mock-invocation-id"),
        operationEvents: [
          {
            operation: {
              Id: "op-123",
              Name: "TestOperation",
              Type: "STEP",
              Status: OperationStatus.SUCCEEDED,
              StartTimestamp: startTime,
              EndTimestamp: endTime,
              StepDetails: {
                Attempt: 1,
                Result: "test-result",
              },
            },
            events: [
              {
                EventId: 1,
                EventTimestamp: eventTime1,
                EventType: "StepStarted",
                Id: "event-1",
                Name: "Start",
              },
              {
                EventId: 2,
                EventTimestamp: eventTime2,
                EventType: "StepSucceeded",
                Id: "event-2",
                Name: "Success",
              },
            ],
          },
        ],
      });
    });

    it("should make a POST request to the correct endpoint with payload", async () => {
      const payload = JSON.stringify({ testKey: "testValue" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockInvocationResultSerialized),
      });

      const result = await apiClient.startDurableExecution(payload);

      expect(mockFetch).toHaveBeenCalledWith(
        `${mockBaseUrl}${API_PATHS.START_DURABLE_EXECUTION}`,
        {
          method: HTTP_METHODS.POST,
          body: JSON.stringify({ payload }),
          headers: {
            "Content-Type": "application/json",
          },
          signal: undefined,
        },
      );
      expect(result).toEqual(mockInvocationResultSerialized);
    });

    it("should throw an error when the request fails", async () => {
      const errorMessage = "Invalid request";
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: jest.fn().mockResolvedValue(errorMessage),
      });

      await expect(apiClient.startDurableExecution()).rejects.toThrow(
        `Error making HTTP request to ${API_PATHS.START_DURABLE_EXECUTION}: status: 400, ${errorMessage}`,
      );
    });
  });

  describe("pollCheckpointData", () => {
    it("should make a GET request to the correct endpoint", async () => {
      const mockResponseDataSerialized: SerializedPollCheckpointResponse = {
        operations: mockOperationsSerialized,
      };
      const mockResponseData = {
        operations: mockOperations,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponseDataSerialized),
      });

      const result = await apiClient.pollCheckpointData(mockExecutionId);

      expect(mockFetch).toHaveBeenCalledWith(
        `${mockBaseUrl}${API_PATHS.POLL_CHECKPOINT_DATA}/${mockExecutionId}`,
        {
          method: HTTP_METHODS.GET,
          body: undefined,
          headers: {
            "Content-Type": "application/json",
          },
          signal: undefined,
        },
      );
      expect(result).toEqual(mockResponseData);
    });

    it("should deserialize timestamps from epoch seconds to Date objects", async () => {
      const startTime = new Date("2021-01-01T00:00:00.000Z");
      const eventTime = new Date("2021-01-01T00:00:30.000Z");

      const serializedResponse: SerializedPollCheckpointResponse = {
        operations: [
          {
            operation: {
              Id: "op-456",
              Type: "STEP",
              Status: OperationStatus.STARTED,
              StartTimestamp: Math.floor(startTime.getTime() / 1000),
            },
            update: {
              Id: "op-456",
              Type: "STEP",
              Action: OperationAction.START,
            },
            events: [
              {
                EventId: 1,
                EventTimestamp: Math.floor(eventTime.getTime() / 1000),
                EventType: "StepStarted",
                Id: "event-1",
              },
            ],
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(serializedResponse),
      });

      const result = await apiClient.pollCheckpointData(mockExecutionId);

      expect(result).toEqual({
        operations: [
          {
            operation: {
              Id: "op-456",
              Type: "STEP",
              Status: OperationStatus.STARTED,
              StartTimestamp: startTime,
            },
            update: {
              Id: "op-456",
              Type: "STEP",
              Action: OperationAction.START,
            },
            events: [
              {
                EventId: 1,
                EventTimestamp: eventTime,
                EventType: "StepStarted",
                Id: "event-1",
              },
            ],
          },
        ],
      });
    });

    it("should pass the abort signal when provided", async () => {
      const mockResponseData = {
        operations: mockOperationsSerialized,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponseData),
      });

      const abortController = new AbortController();
      const signal = abortController.signal;

      await apiClient.pollCheckpointData(mockExecutionId, signal);

      expect(mockFetch).toHaveBeenCalledWith(
        `${mockBaseUrl}${API_PATHS.POLL_CHECKPOINT_DATA}/${mockExecutionId}`,
        {
          method: HTTP_METHODS.GET,
          body: undefined,
          headers: {
            "Content-Type": "application/json",
          },
          signal,
        },
      );
    });

    it("should throw an error when the request fails", async () => {
      const errorMessage = "Execution not found";
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue(errorMessage),
      });

      await expect(
        apiClient.pollCheckpointData(mockExecutionId),
      ).rejects.toThrow(
        `Error making HTTP request to ${API_PATHS.POLL_CHECKPOINT_DATA}/${mockExecutionId}: status: 404, ${errorMessage}`,
      );
    });
  });

  describe("updateCheckpointData", () => {
    it("should make a POST request to the correct endpoint with operation data only", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });

      await apiClient.updateCheckpointData({
        executionId: mockExecutionId,
        operationId: mockOperationId,
        operationData: {
          Status: OperationStatus.SUCCEEDED,
          StepDetails: {
            Result: "hello world",
          },
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${mockBaseUrl}${API_PATHS.UPDATE_CHECKPOINT_DATA}/${mockExecutionId}/${mockOperationId}`,
        {
          method: HTTP_METHODS.POST,
          body: JSON.stringify({
            operationData: {
              Status: OperationStatus.SUCCEEDED,
              StepDetails: {
                Result: "hello world",
              },
            },
            payload: undefined,
            error: undefined,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          signal: undefined,
        },
      );
    });

    it("should include payload in the request body when provided", async () => {
      const payload = JSON.stringify({ result: "test payload data" });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });

      await apiClient.updateCheckpointData({
        executionId: mockExecutionId,
        operationId: mockOperationId,
        operationData: {
          Status: OperationStatus.SUCCEEDED,
          StepDetails: {
            Result: "hello world",
          },
        },
        payload: payload,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${mockBaseUrl}${API_PATHS.UPDATE_CHECKPOINT_DATA}/${mockExecutionId}/${mockOperationId}`,
        {
          method: HTTP_METHODS.POST,
          body: JSON.stringify({
            operationData: {
              Status: OperationStatus.SUCCEEDED,
              StepDetails: {
                Result: "hello world",
              },
            },
            payload: payload,
            error: undefined,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          signal: undefined,
        },
      );
    });

    it("should include error in the request body when provided", async () => {
      const errorObject = {
        ErrorType: "ServiceException",
        ErrorMessage: "Operation failed",
        ErrorData: "Additional error data",
        StackTrace: ["line1", "line2"],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });

      await apiClient.updateCheckpointData({
        executionId: mockExecutionId,
        operationId: mockOperationId,
        operationData: {
          Status: OperationStatus.FAILED,
          StepDetails: {
            Error: errorObject,
          },
        },
        error: errorObject,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${mockBaseUrl}${API_PATHS.UPDATE_CHECKPOINT_DATA}/${mockExecutionId}/${mockOperationId}`,
        {
          method: HTTP_METHODS.POST,
          body: JSON.stringify({
            operationData: {
              Status: OperationStatus.FAILED,
              StepDetails: {
                Error: errorObject,
              },
            },
            payload: undefined,
            error: errorObject,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          signal: undefined,
        },
      );
    });

    it("should include both payload and error in the request body when both are provided", async () => {
      const payload = JSON.stringify({ attemptedValue: "some data" });
      const errorObject = {
        ErrorType: "ValidationException",
        ErrorMessage: "Invalid input data",
        ErrorData: "Validation failed",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });

      await apiClient.updateCheckpointData({
        executionId: mockExecutionId,
        operationId: mockOperationId,
        operationData: {
          Status: OperationStatus.FAILED,
        },
        payload: payload,
        error: errorObject,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${mockBaseUrl}${API_PATHS.UPDATE_CHECKPOINT_DATA}/${mockExecutionId}/${mockOperationId}`,
        {
          method: HTTP_METHODS.POST,
          body: JSON.stringify({
            operationData: {
              Status: OperationStatus.FAILED,
            },
            payload: payload,
            error: errorObject,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          signal: undefined,
        },
      );
    });

    it("should throw an error when the request fails", async () => {
      const errorMessage = "Operation not found";
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue(errorMessage),
      });

      await expect(
        apiClient.updateCheckpointData({
          executionId: mockExecutionId,
          operationId: mockOperationId,
          operationData: {
            Status: OperationStatus.SUCCEEDED,
            StepDetails: {
              Result: "hello world",
            },
          },
        }),
      ).rejects.toThrow(
        `Error making HTTP request to ${API_PATHS.UPDATE_CHECKPOINT_DATA}/${mockExecutionId}/${mockOperationId}: status: 404, ${errorMessage}`,
      );
    });
  });

  describe("startInvocation", () => {
    it("should make a POST request to the correct endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockInvocationResultSerialized),
      });

      const result = await apiClient.startInvocation(mockExecutionId);

      expect(mockFetch).toHaveBeenCalledWith(
        `${mockBaseUrl}${API_PATHS.START_INVOCATION}/${mockExecutionId}`,
        {
          method: HTTP_METHODS.POST,
          body: undefined,
          headers: {
            "Content-Type": "application/json",
          },
          signal: undefined,
        },
      );
      expect(result).toEqual(mockInvocationResultSerialized);
    });

    it("should deserialize timestamps from epoch seconds to Date objects", async () => {
      const startTime = new Date("2021-01-01T00:00:00.000Z");
      const endTime = new Date("2021-01-01T00:01:00.000Z");

      const serializedResult: SerializedInvocationResult = {
        checkpointToken: createCheckpointToken("mock-token"),
        executionId: mockExecutionId,
        invocationId: createInvocationId("mock-invocation-id"),
        operationEvents: [
          {
            operation: {
              Id: "op-789",
              Type: "WAIT",
              Status: OperationStatus.STARTED,
              StartTimestamp: Math.floor(startTime.getTime() / 1000),
              EndTimestamp: Math.floor(endTime.getTime() / 1000),
            },
            events: [],
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(serializedResult),
      });

      const result = await apiClient.startInvocation(mockExecutionId);

      expect(result).toEqual({
        checkpointToken: createCheckpointToken("mock-token"),
        executionId: mockExecutionId,
        invocationId: createInvocationId("mock-invocation-id"),
        operationEvents: [
          {
            operation: {
              Id: "op-789",
              Type: "WAIT",
              Status: OperationStatus.STARTED,
              StartTimestamp: startTime,
              EndTimestamp: endTime,
            },
            events: [],
          },
        ],
      });
    });

    it("should throw an error when the request fails", async () => {
      const errorMessage = "Execution not found";
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue(errorMessage),
      });

      await expect(apiClient.startInvocation(mockExecutionId)).rejects.toThrow(
        `Error making HTTP request to ${API_PATHS.START_INVOCATION}/${mockExecutionId}: status: 404, ${errorMessage}`,
      );
    });
  });

  describe("makeRequest", () => {
    it("should parse JSON response when available", async () => {
      const responseData: SerializedInvocationResult = {
        checkpointToken: createCheckpointToken("test-token"),
        executionId: createExecutionId(),
        invocationId: createInvocationId(),
        operationEvents: [],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(responseData),
      });

      const result = await apiClient.startDurableExecution();
      expect(result).toEqual(responseData);
    });
  });
});
