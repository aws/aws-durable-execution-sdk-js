import { WorkerServerApiHandler } from "../worker-server-api-handler";
import { ApiType } from "../worker-api-types";
import {
  ExecutionManager,
  StartExecutionParams,
} from "../../storage/execution-manager";
import {
  processCompleteInvocation,
  processStartDurableExecution,
  processStartInvocation,
} from "../../handlers/execution-handlers";
import {
  processCheckpointDurableExecution,
  processPollCheckpointData,
  processUpdateCheckpointData,
} from "../../handlers/checkpoint-handlers";
import { processGetDurableExecutionState } from "../../handlers/state-handlers";
import {
  processCallbackFailure,
  processCallbackHeartbeat,
  processCallbackSuccess,
} from "../../handlers/callbacks";
import {
  createExecutionId,
  createInvocationId,
  ExecutionId,
  InvocationId,
} from "../../utils/tagged-strings";
import { StartInvocationRequest } from "../worker-api-request";

// Mock all dependencies
jest.mock("../../storage/execution-manager");
jest.mock("../../handlers/execution-handlers");
jest.mock("../../handlers/checkpoint-handlers");
jest.mock("../../handlers/state-handlers");
jest.mock("../../handlers/callbacks");
jest.mock("../../../logger");

const mockExecutionManager = ExecutionManager as jest.MockedClass<
  typeof ExecutionManager
>;

// Mock handler functions
const mockProcessStartDurableExecution =
  processStartDurableExecution as jest.MockedFunction<
    typeof processStartDurableExecution
  >;
const mockProcessStartInvocation =
  processStartInvocation as jest.MockedFunction<typeof processStartInvocation>;
const mockProcessCompleteInvocation =
  processCompleteInvocation as jest.MockedFunction<
    typeof processCompleteInvocation
  >;
const mockProcessUpdateCheckpointData =
  processUpdateCheckpointData as jest.MockedFunction<
    typeof processUpdateCheckpointData
  >;
const mockProcessPollCheckpointData =
  processPollCheckpointData as jest.MockedFunction<
    typeof processPollCheckpointData
  >;
const mockProcessGetDurableExecutionState =
  processGetDurableExecutionState as jest.MockedFunction<
    typeof processGetDurableExecutionState
  >;
const mockProcessCheckpointDurableExecution =
  processCheckpointDurableExecution as jest.MockedFunction<
    typeof processCheckpointDurableExecution
  >;
const mockProcessCallbackSuccess =
  processCallbackSuccess as jest.MockedFunction<typeof processCallbackSuccess>;
const mockProcessCallbackFailure =
  processCallbackFailure as jest.MockedFunction<typeof processCallbackFailure>;
const mockProcessCallbackHeartbeat =
  processCallbackHeartbeat as jest.MockedFunction<
    typeof processCallbackHeartbeat
  >;

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

describe("WorkerServerApiHandler", () => {
  let handler: WorkerServerApiHandler;
  let mockExecutionManagerInstance: jest.Mocked<ExecutionManager>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock execution manager instance
    mockExecutionManagerInstance = {
      startExecution: jest.fn(),
      getExecution: jest.fn(),
    } as unknown as jest.Mocked<ExecutionManager>;

    // Mock ExecutionManager constructor to return our mock instance
    mockExecutionManager.mockImplementation(() => mockExecutionManagerInstance);

    handler = new WorkerServerApiHandler();
  });

  describe("performApiCall", () => {
    it("should delegate StartDurableExecution to processStartDurableExecution", () => {
      const params: StartExecutionParams = {
        payload: "test-payload",
        invocationId: createInvocationId("test-invocation-id"),
        executionId: createExecutionId("test-execution-id"),
      };

      const requestData = {
        type: ApiType.StartDurableExecution as const,
        requestId: "test-request-id",
        params,
      };

      void handler.performApiCall(requestData);

      expect(mockProcessStartDurableExecution).toHaveBeenCalledWith(
        params,
        mockExecutionManagerInstance,
      );
    });

    it("should delegate StartInvocation to processStartInvocation", () => {
      const params: StartInvocationRequest = {
        executionId: createExecutionId("execution-123"),
        invocationId: createInvocationId("invocation-123"),
      };
      const requestData = {
        type: ApiType.StartInvocation as const,
        requestId: "test-request-id",
        params,
      };

      void handler.performApiCall(requestData);

      expect(mockProcessStartInvocation).toHaveBeenCalledWith(
        params,
        mockExecutionManagerInstance,
      );
    });

    it("should delegate CompleteInvocation to processCompleteInvocation", () => {
      const requestData = {
        type: ApiType.CompleteInvocation as const,
        requestId: "test-request-id",
        params: {
          executionId: "execution-123" as ExecutionId,
          invocationId: "inv-123" as InvocationId,
          error: undefined,
        },
      };

      void handler.performApiCall(requestData);

      expect(mockProcessCompleteInvocation).toHaveBeenCalledWith(
        "execution-123",
        "inv-123",
        undefined,
        mockExecutionManagerInstance,
      );
    });

    it("should delegate SendDurableExecutionCallbackSuccess with Result", () => {
      const requestData = {
        type: ApiType.SendDurableExecutionCallbackSuccess as const,
        requestId: "test-success-id",
        params: {
          CallbackId: "callback-123",
          Result: new Uint8Array(Buffer.from("callback-result-data")),
        },
      };

      void handler.performApiCall(requestData);

      expect(mockProcessCallbackSuccess).toHaveBeenCalledWith(
        "callback-123",
        Buffer.from("callback-result-data"),
        mockExecutionManagerInstance,
      );
    });

    it("should delegate SendDurableExecutionCallbackSuccess without Result", () => {
      const requestData = {
        type: ApiType.SendDurableExecutionCallbackSuccess as const,
        requestId: "test-success-id",
        params: {
          CallbackId: "callback-123",
          Result: undefined,
        },
      };

      void handler.performApiCall(requestData);

      expect(mockProcessCallbackSuccess).toHaveBeenCalledWith(
        "callback-123",
        Buffer.of(),
        mockExecutionManagerInstance,
      );
    });

    it("should delegate UpdateCheckpointData to processUpdateCheckpointData", () => {
      const requestData = {
        type: ApiType.UpdateCheckpointData as const,
        requestId: TEST_UUIDS.FIRST,
        params: {
          executionId: "execution-123" as ExecutionId,
          operationId: "op-123",
          operationData: {},
          payload: "payload-data",
          error: undefined,
        },
      };

      void handler.performApiCall(requestData);

      expect(mockProcessUpdateCheckpointData).toHaveBeenCalledWith(
        "execution-123",
        "op-123",
        {},
        "payload-data",
        undefined,
        mockExecutionManagerInstance,
      );
    });

    it("should delegate PollCheckpointData to processPollCheckpointData", () => {
      const requestData = {
        type: ApiType.PollCheckpointData as const,
        requestId: TEST_UUIDS.SECOND,
        params: { executionId: "execution-123" as ExecutionId },
      };

      void handler.performApiCall(requestData);

      expect(mockProcessPollCheckpointData).toHaveBeenCalledWith(
        "execution-123",
        mockExecutionManagerInstance,
      );
    });

    it("should delegate GetDurableExecutionState to processGetDurableExecutionState", () => {
      const requestData = {
        type: ApiType.GetDurableExecutionState as const,
        requestId: TEST_UUIDS.THIRD,
        params: {
          DurableExecutionArn:
            "arn:aws:lambda:us-east-1:123456789012:function:test",
        },
      };

      void handler.performApiCall(requestData);

      expect(mockProcessGetDurableExecutionState).toHaveBeenCalledWith(
        "arn:aws:lambda:us-east-1:123456789012:function:test",
        mockExecutionManagerInstance,
      );
    });

    it("should delegate CheckpointDurableExecutionState to processCheckpointDurableExecution", async () => {
      const requestData = {
        type: ApiType.CheckpointDurableExecutionState as const,
        requestId: TEST_UUIDS.SUCCESS,
        params: {
          DurableExecutionArn:
            "arn:aws:lambda:us-east-1:123456789012:function:test",
          CheckpointToken: "test-checkpoint-token",
        },
      };

      await handler.performApiCall(requestData);

      expect(mockProcessCheckpointDurableExecution).toHaveBeenCalledWith(
        "arn:aws:lambda:us-east-1:123456789012:function:test",
        {
          DurableExecutionArn:
            "arn:aws:lambda:us-east-1:123456789012:function:test",
          CheckpointToken: "test-checkpoint-token",
        },
        mockExecutionManagerInstance,
      );
    });

    it("should delegate SendDurableExecutionCallbackFailure to processCallbackFailure", () => {
      const requestData = {
        type: ApiType.SendDurableExecutionCallbackFailure as const,
        requestId: TEST_UUIDS.ERROR,
        params: {
          CallbackId: "callback-123",
          Error: {
            ErrorCode: "TEST_ERROR",
            ErrorMessage: "Callback failed",
          },
        },
      };

      void handler.performApiCall(requestData);

      expect(mockProcessCallbackFailure).toHaveBeenCalledWith(
        "callback-123",
        {
          ErrorCode: "TEST_ERROR",
          ErrorMessage: "Callback failed",
        },
        mockExecutionManagerInstance,
      );
    });

    it("should delegate SendDurableExecutionCallbackHeartbeat", () => {
      const requestData = {
        type: ApiType.SendDurableExecutionCallbackHeartbeat as const,
        requestId: "test-heartbeat-id",
        params: { CallbackId: "callback-123" },
      };

      void handler.performApiCall(requestData);

      expect(mockProcessCallbackHeartbeat).toHaveBeenCalledWith(
        "callback-123",
        mockExecutionManagerInstance,
      );
    });

    it("should throw error for unexpected API type", () => {
      const invalidRequestData = {
        type: "INVALID_TYPE",
        requestId: "test-request-id",
        params: {},
      };

      expect(() => {
        void handler.performApiCall(invalidRequestData as never);
      }).toThrow("Unexpected data ApiType");
    });
  });

  describe("CheckpointDurableExecutionState with delayMs", () => {
    let setTimeoutSpy: jest.SpyInstance;
    let mathRandomSpy: jest.SpyInstance;

    beforeEach(() => {
      setTimeoutSpy = jest.spyOn(global, "setTimeout");
      mathRandomSpy = jest.spyOn(Math, "random");

      mockProcessCheckpointDurableExecution.mockReturnValue({
        CheckpointToken: "test-response-token",
        NewExecutionState: {
          Operations: [],
          NextMarker: undefined,
        },
      });
    });

    afterEach(() => {
      setTimeoutSpy.mockRestore();
      mathRandomSpy.mockRestore();
    });

    it("should execute immediately when no delay settings provided", async () => {
      const handler = new WorkerServerApiHandler();
      const requestData = {
        type: ApiType.CheckpointDurableExecutionState as const,
        requestId: TEST_UUIDS.SUCCESS,
        params: {
          DurableExecutionArn:
            "arn:aws:lambda:us-east-1:123456789012:function:test",
          CheckpointToken: "test-checkpoint-token",
        },
      };

      await handler.performApiCall(requestData);

      expect(setTimeoutSpy).toHaveBeenCalledWith(
        expect.any(Function),
        undefined,
      );
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });

    it("should reject promise when processCheckpointDurableExecution throws error after delay", async () => {
      const handler = new WorkerServerApiHandler({
        checkpointDelaySettings: 10,
      });
      const requestData = {
        type: ApiType.CheckpointDurableExecutionState as const,
        requestId: TEST_UUIDS.ERROR,
        params: {
          DurableExecutionArn:
            "arn:aws:lambda:us-east-1:123456789012:function:test",
          CheckpointToken: "test-checkpoint-token",
        },
      };

      const testError = new Error("Checkpoint processing failed");
      mockProcessCheckpointDurableExecution.mockImplementation(() => {
        throw testError;
      });

      await expect(handler.performApiCall(requestData)).rejects.toThrow(
        "Checkpoint processing failed",
      );

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10);
    });
  });
});
