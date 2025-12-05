import { WorkerClientApiHandler } from "../worker-client-api-handler";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { ApiType } from "../../../../checkpoint-server/worker-api/worker-api-types";
import { WorkerCommandType } from "../../../../checkpoint-server/worker/worker-message-types";
import { defaultLogger } from "../../../../logger";
import {
  createInvocationId,
  ExecutionId,
} from "../../../../checkpoint-server/utils/tagged-strings";
import {
  StartDurableExecutionRequest,
  StartInvocationRequest,
} from "../../../../checkpoint-server/worker-api/worker-api-request";

// Mock dependencies
jest.mock("node:worker_threads");
jest.mock("node:crypto");
jest.mock("../../../../logger");

const mockRandomUUID = randomUUID as jest.MockedFunction<typeof randomUUID>;
const mockDefaultLogger = defaultLogger as jest.Mocked<typeof defaultLogger>;

// Predefined UUIDs for consistent testing
const TEST_UUIDS = {
  DEFAULT: "12345678-1234-1234-1234-123456789012",
  FIRST: "11111111-1111-1111-1111-111111111111",
  SECOND: "22222222-2222-2222-2222-222222222222",
  THIRD: "33333333-3333-3333-3333-333333333333",
  SUCCESS: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  ERROR: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  CLEANUP: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  SAME: "dddddddd-dddd-dddd-dddd-dddddddddddd",
} as const;

describe("WorkerClientApiHandler", () => {
  let handler: WorkerClientApiHandler;
  let mockWorker: jest.Mocked<Worker>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock worker
    mockWorker = {
      postMessage: jest.fn(),
      terminate: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    } as unknown as jest.Mocked<Worker>;

    // Mock randomUUID to return predictable UUIDs
    mockRandomUUID.mockReturnValue(TEST_UUIDS.DEFAULT);

    handler = new WorkerClientApiHandler();
  });

  describe("callWorkerApi", () => {
    it("should send correct message to worker via postMessage", async () => {
      const apiType = ApiType.StartDurableExecution;
      const params = {
        payload: "test-payload",
        invocationId: createInvocationId(),
      };

      // Start the API call but don't await it yet
      const promise = handler.callWorkerApi(apiType, params, mockWorker);

      // Verify worker.postMessage was called with correct structure
      expect(mockWorker.postMessage).toHaveBeenCalledWith({
        type: WorkerCommandType.API_REQUEST,
        data: {
          requestId: "12345678-1234-1234-1234-123456789012",
          type: apiType,
          params,
        },
      });

      // Now resolve the promise by simulating a response
      handler.handleApiCallResponse({
        type: apiType,
        requestId: "12345678-1234-1234-1234-123456789012",
        response: { result: "success" },
      });

      const result = await promise;
      expect(result).toEqual({ result: "success" });
    });

    it("should generate unique request ID for each call", async () => {
      mockRandomUUID
        .mockReturnValueOnce("11111111-1111-1111-1111-111111111111")
        .mockReturnValueOnce("22222222-2222-2222-2222-222222222222");

      const params1: StartDurableExecutionRequest = {
        payload: "test1",
        invocationId: createInvocationId("test-invocation-id"),
      };

      // Start two API calls
      const promise1 = handler.callWorkerApi(
        ApiType.StartDurableExecution,
        params1,
        mockWorker,
      );

      const params2: StartInvocationRequest = {
        executionId: "test-execution" as ExecutionId,
        invocationId: createInvocationId("test-invocation-id"),
      };

      const promise2 = handler.callWorkerApi(
        ApiType.StartInvocation,
        params2,
        mockWorker,
      );

      // Verify different request IDs were used
      expect(mockWorker.postMessage).toHaveBeenNthCalledWith(1, {
        type: WorkerCommandType.API_REQUEST,
        data: {
          requestId: "11111111-1111-1111-1111-111111111111",
          type: ApiType.StartDurableExecution,
          params: params1,
        },
      });

      expect(mockWorker.postMessage).toHaveBeenNthCalledWith(2, {
        type: WorkerCommandType.API_REQUEST,
        data: {
          requestId: "22222222-2222-2222-2222-222222222222",
          type: ApiType.StartInvocation,
          params: params2,
        },
      });

      // Resolve both promises
      handler.handleApiCallResponse({
        type: ApiType.StartDurableExecution,
        requestId: "11111111-1111-1111-1111-111111111111",
        response: { result: "success1" },
      });
      handler.handleApiCallResponse({
        type: ApiType.StartInvocation,
        requestId: "22222222-2222-2222-2222-222222222222",
        response: { result: "success2" },
      });

      expect(await promise1).toEqual({ result: "success1" });
      expect(await promise2).toEqual({ result: "success2" });
    });

    it.each([
      {
        name: "StartDurableExecution",
        apiType: ApiType.StartDurableExecution,
        params: { payload: "test", invocationId: createInvocationId() },
        uuid: TEST_UUIDS.SUCCESS,
      },
      {
        name: "UpdateCheckpointData",
        apiType: ApiType.UpdateCheckpointData,
        params: {
          executionId: "exec-id" as ExecutionId,
          operationId: "op-id",
          operationData: {},
        },
        uuid: TEST_UUIDS.ERROR,
      },
      {
        name: "PollCheckpointData",
        apiType: ApiType.PollCheckpointData,
        params: { executionId: "exec-id" as ExecutionId },
        uuid: TEST_UUIDS.CLEANUP,
      },
    ] as const)(
      "should handle $name API type correctly",
      async ({ apiType, params, uuid }) => {
        mockRandomUUID.mockReturnValue(uuid);

        const promise = handler.callWorkerApi(apiType, params, mockWorker);

        expect(mockWorker.postMessage).toHaveBeenCalledWith({
          type: WorkerCommandType.API_REQUEST,
          data: {
            requestId: uuid,
            type: apiType,
            params,
          },
        });

        // Resolve the promise
        handler.handleApiCallResponse({
          type: apiType,
          requestId: uuid,
          response: { result: `success-${apiType}` },
        });

        const result = await promise;
        expect(result).toEqual({ result: `success-${apiType}` });
      },
    );
  });

  describe("handleApiCallResponse", () => {
    it("should resolve promise when success response is received", async () => {
      mockRandomUUID.mockReturnValue(TEST_UUIDS.SUCCESS);

      // Start API call
      const promise = handler.callWorkerApi(
        ApiType.StartDurableExecution,
        {
          payload: "test",
          invocationId: createInvocationId("test-invocation-id"),
        },
        mockWorker,
      );

      // Simulate successful response
      const successResponse = {
        type: ApiType.StartDurableExecution,
        requestId: TEST_UUIDS.SUCCESS,
        response: { executionId: "exec-123", status: "started" },
      };

      handler.handleApiCallResponse(successResponse);

      const result = await promise;
      expect(result).toEqual({ executionId: "exec-123", status: "started" });
    });

    it("should reject promise when error response is received", async () => {
      mockRandomUUID.mockReturnValue(TEST_UUIDS.ERROR);

      // Start API call
      const promise = handler.callWorkerApi(
        ApiType.StartDurableExecution,
        {
          payload: "test",
          invocationId: createInvocationId("test-invocation-id"),
        },
        mockWorker,
      );

      // Simulate error response
      const errorResponse = {
        type: ApiType.StartDurableExecution,
        requestId: TEST_UUIDS.ERROR,
        error: new Error("Worker API failed"),
      };

      handler.handleApiCallResponse(errorResponse);

      await expect(promise).rejects.toThrow("Worker API failed");
    });

    it("should handle missing handler gracefully and log warning", () => {
      const unknownResponse = {
        type: ApiType.StartDurableExecution,
        requestId: "non-existent-id",
        response: { result: "success" },
      };

      // Should not throw
      handler.handleApiCallResponse(unknownResponse);

      // Should log warning
      expect(mockDefaultLogger.warn).toHaveBeenCalledWith(
        `Could not find API handler for ${ApiType.StartDurableExecution} request with ID non-existent-id`,
      );
    });

    it("should clean up handler after successful response", async () => {
      mockRandomUUID.mockReturnValue(TEST_UUIDS.CLEANUP);

      // Start API call
      const promise = handler.callWorkerApi(
        ApiType.StartDurableExecution,
        {
          payload: "test",
          invocationId: createInvocationId("test-invocation-id"),
        },
        mockWorker,
      );

      // Resolve the promise
      handler.handleApiCallResponse({
        type: ApiType.StartDurableExecution,
        requestId: TEST_UUIDS.CLEANUP,
        response: { result: "success" },
      });

      await promise;

      // Try to handle response again with same ID - should log warning
      handler.handleApiCallResponse({
        type: ApiType.StartDurableExecution,
        requestId: TEST_UUIDS.CLEANUP,
        response: { result: "duplicate" },
      });

      expect(mockDefaultLogger.warn).toHaveBeenCalledWith(
        `Could not find API handler for ${ApiType.StartDurableExecution} request with ID ${TEST_UUIDS.CLEANUP}`,
      );
    });

    it("should clean up handler after error response", async () => {
      mockRandomUUID.mockReturnValue(TEST_UUIDS.THIRD);

      // Start API call
      const promise = handler.callWorkerApi(
        ApiType.StartDurableExecution,
        {
          payload: "test",
          invocationId: createInvocationId("test-invocation-id"),
        },
        mockWorker,
      );

      // Reject the promise
      handler.handleApiCallResponse({
        type: ApiType.StartDurableExecution,
        requestId: TEST_UUIDS.THIRD,
        error: new Error("Test error"),
      });

      await expect(promise).rejects.toThrow("Test error");

      // Try to handle response again with same ID - should log warning
      handler.handleApiCallResponse({
        type: ApiType.StartDurableExecution,
        requestId: TEST_UUIDS.THIRD,
        response: { result: "after-error" },
      });

      expect(mockDefaultLogger.warn).toHaveBeenCalledWith(
        `Could not find API handler for ${ApiType.StartDurableExecution} request with ID ${TEST_UUIDS.THIRD}`,
      );
    });
  });

  describe("Concurrent API Calls", () => {
    it("should handle multiple concurrent API calls independently", async () => {
      mockRandomUUID
        .mockReturnValueOnce(TEST_UUIDS.FIRST)
        .mockReturnValueOnce(TEST_UUIDS.SECOND)
        .mockReturnValueOnce(TEST_UUIDS.THIRD);

      // Start three concurrent API calls
      const promise1 = handler.callWorkerApi(
        ApiType.StartDurableExecution,
        {
          payload: "test1",
          invocationId: createInvocationId("test-invocation-id"),
        },
        mockWorker,
      );
      const promise2 = handler.callWorkerApi(
        ApiType.UpdateCheckpointData,
        {
          executionId: "exec-id" as ExecutionId,
          operationId: "op-id",
          operationData: {},
        },
        mockWorker,
      );
      const promise3 = handler.callWorkerApi(
        ApiType.PollCheckpointData,
        { executionId: "exec-id" as ExecutionId },
        mockWorker,
      );

      // Resolve them in different order
      handler.handleApiCallResponse({
        type: ApiType.PollCheckpointData,
        requestId: TEST_UUIDS.THIRD,
        response: { result: "result3" },
      });
      handler.handleApiCallResponse({
        type: ApiType.StartDurableExecution,
        requestId: TEST_UUIDS.FIRST,
        response: { result: "result1" },
      });
      handler.handleApiCallResponse({
        type: ApiType.UpdateCheckpointData,
        requestId: TEST_UUIDS.SECOND,
        response: { result: "result2" },
      });

      // All should resolve with correct results
      expect(await promise1).toEqual({ result: "result1" });
      expect(await promise2).toEqual({ result: "result2" });
      expect(await promise3).toEqual({ result: "result3" });
    });

    it("should handle mix of success and error responses", async () => {
      mockRandomUUID
        .mockReturnValueOnce(TEST_UUIDS.SUCCESS)
        .mockReturnValueOnce(TEST_UUIDS.ERROR);

      // Start two API calls
      const successPromise = handler.callWorkerApi(
        ApiType.StartDurableExecution,
        {
          payload: "success",
          invocationId: createInvocationId("test-invocation-id"),
        },
        mockWorker,
      );
      const errorPromise = handler.callWorkerApi(
        ApiType.UpdateCheckpointData,
        {
          executionId: "exec-id" as ExecutionId,
          operationId: "op-id",
          operationData: {},
        },
        mockWorker,
      );

      // Resolve one with success, one with error
      handler.handleApiCallResponse({
        type: ApiType.StartDurableExecution,
        requestId: TEST_UUIDS.SUCCESS,
        response: { result: "success" },
      });
      handler.handleApiCallResponse({
        type: ApiType.UpdateCheckpointData,
        requestId: TEST_UUIDS.ERROR,
        error: new Error("API call failed"),
      });

      // Success promise should resolve
      expect(await successPromise).toEqual({ result: "success" });

      // Error promise should reject
      await expect(errorPromise).rejects.toThrow("API call failed");
    });
  });

  describe("API Type Isolation", () => {
    it("should isolate different API types in separate maps", async () => {
      mockRandomUUID
        .mockReturnValueOnce(TEST_UUIDS.SAME)
        .mockReturnValueOnce(TEST_UUIDS.SAME); // Same UUID but different API types

      // Start calls for different API types with same UUID
      const promise1 = handler.callWorkerApi(
        ApiType.StartDurableExecution,
        {
          payload: "test1",
          invocationId: createInvocationId("test-invocation-id"),
        },
        mockWorker,
      );
      const promise2 = handler.callWorkerApi(
        ApiType.UpdateCheckpointData,
        {
          executionId: "exec-id" as ExecutionId,
          operationId: "op-id",
          operationData: {},
        },
        mockWorker,
      );

      // Respond to both with same UUID but different types
      handler.handleApiCallResponse({
        type: ApiType.StartDurableExecution,
        requestId: TEST_UUIDS.SAME,
        response: { result: "execution-result" },
      });
      handler.handleApiCallResponse({
        type: ApiType.UpdateCheckpointData,
        requestId: TEST_UUIDS.SAME,
        response: { result: "checkpoint-result" },
      });

      // Both should resolve with their respective results
      expect(await promise1).toEqual({ result: "execution-result" });
      expect(await promise2).toEqual({ result: "checkpoint-result" });
    });
  });
});
