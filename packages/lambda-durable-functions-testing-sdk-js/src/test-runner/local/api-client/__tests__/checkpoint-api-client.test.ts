import { CheckpointApiClient } from "../checkpoint-api-client";
import { OperationStatus } from "@aws-sdk/client-lambda";
import {
  API_PATHS,
  HTTP_METHODS,
} from "../../../../checkpoint-server/constants";
import { createExecutionId } from "../../../../checkpoint-server/utils/tagged-strings";

// Mock the global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("CheckpointApiClient", () => {
  const mockBaseUrl = `http://127.0.0.1:1234`;
  const apiClient = new CheckpointApiClient(mockBaseUrl);
  const mockExecutionId = createExecutionId("mock-execution-id");
  const mockOperationId = "mock-operation-id";
  const mockInvocationResult = {
    checkpointToken: "mock-token",
    executionId: mockExecutionId,
    invocationId: "mock-invocation-id",
    operations: [],
  };
  const mockOperations = [
    {
      operation: { id: "op1", type: "STEP" },
      update: { id: "op1", type: "STEP" },
    },
  ];

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  describe("startDurableExecution", () => {
    it("should make a POST request to the correct endpoint without payload", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockInvocationResult),
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
        }
      );
      expect(result).toEqual(mockInvocationResult);
    });

    it("should make a POST request to the correct endpoint with payload", async () => {
      const payload = JSON.stringify({ testKey: "testValue" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockInvocationResult),
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
        }
      );
      expect(result).toEqual(mockInvocationResult);
    });

    it("should throw an error when the request fails", async () => {
      const errorMessage = "Invalid request";
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: jest.fn().mockResolvedValue(errorMessage),
      });

      await expect(apiClient.startDurableExecution()).rejects.toThrow(
        `Error making HTTP request to ${API_PATHS.START_DURABLE_EXECUTION}: status: 400, ${errorMessage}`
      );
    });
  });

  describe("pollCheckpointData", () => {
    it("should make a GET request to the correct endpoint", async () => {
      const mockResponseData = {
        operations: mockOperations,
        operationInvocationIdMap: { op1: ["invocation-1"] },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponseData),
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
        }
      );
      expect(result).toEqual(mockResponseData);
    });

    it("should pass the abort signal when provided", async () => {
      const mockResponseData = {
        operations: mockOperations,
        operationInvocationIdMap: { op1: ["invocation-1"] },
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
        }
      );
    });

    it("should handle response with operationInvocationIdMap", async () => {
      const mockResponseData = {
        operations: mockOperations,
        operationInvocationIdMap: {
          op1: ["invocation-1", "invocation-2"],
          op2: ["invocation-3"],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponseData),
      });

      const result = await apiClient.pollCheckpointData(mockExecutionId);

      expect(result.operations).toEqual(mockOperations);
      expect(result.operationInvocationIdMap).toEqual({
        op1: ["invocation-1", "invocation-2"],
        op2: ["invocation-3"],
      });
    });

    it("should handle response with empty operationInvocationIdMap", async () => {
      const mockResponseData = {
        operations: mockOperations,
        operationInvocationIdMap: {},
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponseData),
      });

      const result = await apiClient.pollCheckpointData(mockExecutionId);

      expect(result.operations).toEqual(mockOperations);
      expect(result.operationInvocationIdMap).toEqual({});
    });

    it("should throw an error when the request fails", async () => {
      const errorMessage = "Execution not found";
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue(errorMessage),
      });

      await expect(
        apiClient.pollCheckpointData(mockExecutionId)
      ).rejects.toThrow(
        `Error making HTTP request to ${API_PATHS.POLL_CHECKPOINT_DATA}/${mockExecutionId}: status: 404, ${errorMessage}`
      );
    });
  });

  describe("updateCheckpointData", () => {
    it("should make a POST request to the correct endpoint with status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });

      await apiClient.updateCheckpointData({
        executionId: mockExecutionId,
        operationId: mockOperationId,
        status: OperationStatus.READY,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${mockBaseUrl}${API_PATHS.UPDATE_CHECKPOINT_DATA}/${mockExecutionId}/${mockOperationId}`,
        {
          method: HTTP_METHODS.POST,
          body: JSON.stringify({
            action: undefined,
            status: OperationStatus.READY,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          signal: undefined,
        }
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
          status: OperationStatus.SUCCEEDED,
        })
      ).rejects.toThrow(
        `Error making HTTP request to ${API_PATHS.UPDATE_CHECKPOINT_DATA}/${mockExecutionId}/${mockOperationId}: status: 404, ${errorMessage}`
      );
    });
  });

  describe("startInvocation", () => {
    it("should make a POST request to the correct endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockInvocationResult),
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
        }
      );
      expect(result).toEqual(mockInvocationResult);
    });

    it("should throw an error when the request fails", async () => {
      const errorMessage = "Execution not found";
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue(errorMessage),
      });

      await expect(apiClient.startInvocation(mockExecutionId)).rejects.toThrow(
        `Error making HTTP request to ${API_PATHS.START_INVOCATION}/${mockExecutionId}: status: 404, ${errorMessage}`
      );
    });
  });

  describe("makeRequest", () => {
    it("should parse JSON response when available", async () => {
      const responseData = { success: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(responseData),
      });

      const result = await apiClient.startDurableExecution();
      expect(result).toEqual(responseData);
    });
  });
});
