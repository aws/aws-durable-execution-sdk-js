import { MessagePort } from "worker_threads";
import { CheckpointWorker } from "../checkpoint-worker";
import { WorkerServerApiHandler } from "../../worker-api/worker-server-api-handler";
import {
  WorkerCommand,
  WorkerCommandType,
  WorkerResponseType,
} from "../worker-message-types";
import { ApiType } from "../../worker-api/worker-api-types";
import {
  createCheckpointToken,
  createExecutionId,
  createInvocationId,
} from "../../utils/tagged-strings";
import { InvocationResult } from "../../storage/execution-manager";

// Mock external dependencies
jest.mock("worker_threads", () => ({
  workerData: {
    checkpointDelaySettings: 100,
  },
}));
jest.mock("../../worker-api/worker-server-api-handler");

const mockWorkerServerApiHandler = WorkerServerApiHandler as jest.MockedClass<
  typeof WorkerServerApiHandler
>;

describe("CheckpointWorker", () => {
  let worker: CheckpointWorker;
  let mockMessagePort: jest.Mocked<MessagePort>;
  let mockApiHandlerInstance: jest.Mocked<WorkerServerApiHandler>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock MessagePort
    mockMessagePort = {
      on: jest.fn(),
      postMessage: jest.fn(),
    } as unknown as jest.Mocked<MessagePort>;

    // Create mock WorkerServerApiHandler instance
    mockApiHandlerInstance = {
      performApiCall: jest.fn(),
    } as unknown as jest.Mocked<WorkerServerApiHandler>;

    // Mock constructor to return our instance
    mockWorkerServerApiHandler.mockImplementation(() => mockApiHandlerInstance);

    worker = new CheckpointWorker(mockMessagePort);
  });

  describe("constructor", () => {
    it("should pass workerParams to WorkerServerApiHandler constructor", () => {
      // Constructor was already called in beforeEach, verify it was called with workerParams
      expect(mockWorkerServerApiHandler).toHaveBeenCalledWith({
        checkpointDelaySettings: 100,
      });
    });
  });

  describe("initialize", () => {
    it("should set up message handling on the message port", () => {
      worker.initialize();

      expect(mockMessagePort.on).toHaveBeenCalledWith(
        "message",
        expect.any(Function),
      );
    });
  });

  describe("message handling", () => {
    let messageHandler: (command: WorkerCommand) => void;

    beforeEach(() => {
      worker.initialize();
      messageHandler = mockMessagePort.on.mock.calls[0][1];
    });

    it("should delegate API call to WorkerServerApiHandler", () => {
      const command: WorkerCommand = {
        type: WorkerCommandType.API_REQUEST,
        data: {
          type: ApiType.UpdateCheckpointData,
          requestId: "test-request-123",
          params: {
            executionId: createExecutionId("exec-123"),
            operationId: "op-456",
            operationData: {},
          },
        },
      };

      const mockResponse = {};
      mockApiHandlerInstance.performApiCall.mockReturnValue(mockResponse);

      messageHandler(command);

      expect(mockApiHandlerInstance.performApiCall).toHaveBeenCalledWith(
        command.data,
      );
    });

    it("should send synchronous response immediately", () => {
      const command: WorkerCommand = {
        type: WorkerCommandType.API_REQUEST,
        data: {
          type: ApiType.UpdateCheckpointData,
          requestId: "test-request-123",
          params: {
            executionId: createExecutionId("exec-123"),
            operationId: "op-456",
            operationData: {},
          },
        },
      };

      const syncResponse = {};
      mockApiHandlerInstance.performApiCall.mockReturnValue(syncResponse);

      messageHandler(command);

      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.API_RESPONSE,
        data: {
          type: ApiType.UpdateCheckpointData,
          requestId: "test-request-123",
          response: syncResponse,
        },
      });
    });

    it("should handle promise response success", async () => {
      const command: WorkerCommand = {
        type: WorkerCommandType.API_REQUEST,
        data: {
          type: ApiType.CheckpointDurableExecutionState,
          requestId: "async-request-456",
          params: {
            DurableExecutionArn:
              "arn:aws:lambda:us-east-1:123456789012:function:test",
            CheckpointToken: "test-token",
          },
        },
      };

      const promiseResponse = Promise.resolve({
        CheckpointToken: "new-token",
        NewExecutionState: {
          Operations: [],
          NextMarker: undefined,
        },
      });
      mockApiHandlerInstance.performApiCall.mockReturnValue(promiseResponse);

      messageHandler(command);

      // Wait for promise to resolve
      await promiseResponse;

      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.API_RESPONSE,
        data: {
          type: ApiType.CheckpointDurableExecutionState,
          requestId: "async-request-456",
          response: {
            CheckpointToken: "new-token",
            NewExecutionState: {
              Operations: [],
              NextMarker: undefined,
            },
          },
        },
      });
    });

    it("should handle promise response rejection", async () => {
      const command: WorkerCommand = {
        type: WorkerCommandType.API_REQUEST,
        data: {
          type: ApiType.CheckpointDurableExecutionState,
          requestId: "async-error-789",
          params: {
            DurableExecutionArn:
              "arn:aws:lambda:us-east-1:123456789012:function:test",
            CheckpointToken: "test-token",
          },
        },
      };

      const rejectionError = new Error("Async operation failed");
      const promiseResponse = Promise.reject(rejectionError);
      mockApiHandlerInstance.performApiCall.mockReturnValue(promiseResponse);

      messageHandler(command);

      // Wait for promise to reject
      try {
        await promiseResponse;
      } catch {
        // Expected
      }

      // Give a tick for the promise handlers to execute
      await new Promise(setImmediate);

      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.API_RESPONSE,
        data: {
          type: ApiType.CheckpointDurableExecutionState,
          requestId: "async-error-789",
          error: rejectionError,
        },
      });
    });

    it("should handle synchronous errors from API handler", () => {
      const command: WorkerCommand = {
        type: WorkerCommandType.API_REQUEST,
        data: {
          type: ApiType.UpdateCheckpointData,
          requestId: "error-request-999",
          params: {
            executionId: createExecutionId("exec-999"),
            operationId: "op-error",
            operationData: {},
          },
        },
      };

      const thrownError = new Error("Synchronous error occurred");
      mockApiHandlerInstance.performApiCall.mockImplementation(() => {
        throw thrownError;
      });

      messageHandler(command);

      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.API_RESPONSE,
        data: {
          requestId: "error-request-999",
          type: ApiType.UpdateCheckpointData,
          error: thrownError,
        },
      });
    });

    it("should handle StartInvocation API with proper delegation", () => {
      const executionId = createExecutionId("exec-start-123");
      const invocationId = createInvocationId("inv-start-456");
      const command: WorkerCommand = {
        type: WorkerCommandType.API_REQUEST,
        data: {
          type: ApiType.StartInvocation,
          requestId: "start-request-123",
          params: {
            executionId,
            invocationId,
          },
        },
      };

      const mockInvocationResult: InvocationResult = {
        checkpointToken: createCheckpointToken("start-token"),
        executionId,
        operationEvents: [],
        invocationId,
      };
      mockApiHandlerInstance.performApiCall.mockReturnValue(
        mockInvocationResult,
      );

      messageHandler(command);

      expect(mockApiHandlerInstance.performApiCall).toHaveBeenCalledWith(
        command.data,
      );
      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.API_RESPONSE,
        data: {
          type: ApiType.StartInvocation,
          requestId: "start-request-123",
          response: mockInvocationResult,
        },
      });
    });

    it("should handle CompleteInvocation API with proper delegation", () => {
      const command: WorkerCommand = {
        type: WorkerCommandType.API_REQUEST,
        data: {
          type: ApiType.CompleteInvocation,
          requestId: "complete-request-456",
          params: {
            executionId: createExecutionId("exec-complete-456"),
            invocationId: createInvocationId("inv-complete-789"),
            error: undefined,
          },
        },
      };

      const mockEvent = {
        Id: "event-123",
        Timestamp: new Date(),
        Type: "InvocationComplete",
      };
      mockApiHandlerInstance.performApiCall.mockReturnValue({
        event: mockEvent,
        hasDirtyOperations: false,
      });

      messageHandler(command);

      expect(mockApiHandlerInstance.performApiCall).toHaveBeenCalledWith(
        command.data,
      );
      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.API_RESPONSE,
        data: {
          type: ApiType.CompleteInvocation,
          requestId: "complete-request-456",
          response: {
            event: mockEvent,
            hasDirtyOperations: false,
          },
        },
      });
    });
  });
});
