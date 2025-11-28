import { createInvokeHandler } from "./invoke-handler";
import { ExecutionContext, OperationSubType } from "../../types";
import {
  OperationStatus,
  OperationType,
  OperationAction,
} from "@aws-sdk/client-lambda";
import { TerminationReason } from "../../termination-manager/types";
import { EventEmitter } from "events";

// Mock dependencies
jest.mock("../../utils/checkpoint/checkpoint-manager");
jest.mock("../../utils/termination-helper/termination-helper");
jest.mock("../../utils/logger/logger");
jest.mock("../../errors/serdes-errors/serdes-errors");
jest.mock("../../utils/wait-before-continue/wait-before-continue");

import { terminate } from "../../utils/termination-helper/termination-helper";
import { log } from "../../utils/logger/logger";
import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";
import { waitBeforeContinue } from "../../utils/wait-before-continue/wait-before-continue";

const mockTerminate = terminate as jest.MockedFunction<typeof terminate>;
const mockLog = log as jest.MockedFunction<typeof log>;
const mockSafeSerialize = safeSerialize as jest.MockedFunction<
  typeof safeSerialize
>;
const mockSafeDeserialize = safeDeserialize as jest.MockedFunction<
  typeof safeDeserialize
>;
const mockWaitBeforeContinue = waitBeforeContinue as jest.MockedFunction<
  typeof waitBeforeContinue
>;

describe("InvokeHandler", () => {
  let mockContext: ExecutionContext;
  let mockCreateStepId: jest.Mock;
  let mockHasRunningOperations: jest.Mock;
  let mockCheckpointFn: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up default mock for waitBeforeContinue
    mockWaitBeforeContinue.mockResolvedValue({
      reason: "operations",
      canTerminate: true,
    });

    mockCreateStepId = jest.fn().mockReturnValue("test-step-1");
    mockHasRunningOperations = jest.fn().mockReturnValue(false);

    // Create a proper checkpoint mock with force method
    mockCheckpointFn = {
      checkpoint: jest.fn().mockResolvedValue(undefined),
      force: jest.fn().mockResolvedValue(undefined),
    };

    mockContext = {
      state: {
        operations: [],
        nextMarker: "1",
        getStepData: jest.fn(),
        checkpoint: jest.fn(),
      },
      _stepData: {},
      terminationManager: {
        terminate: jest.fn(),
      },
      isVerbose: true,
      durableExecutionArn: "test-arn",
      parentId: "parent-123",
      getStepData: jest.fn().mockReturnValue(undefined),
    } as any;

    // Mock serdes functions
    mockSafeSerialize.mockResolvedValue('{"serialized":"data"}');
    mockSafeDeserialize.mockResolvedValue({ deserialized: "data" });

    // Mock terminate to throw (simulating termination)
    mockTerminate.mockImplementation(() => {
      throw new Error("Execution terminated");
    });
  });

  describe("invoke", () => {
    it("should return cached result for completed invoke", async () => {
      const mockGetStepData = jest.fn().mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        ChainedInvokeDetails: {
          Result: '{"result":"success"}',
        },
      });

      mockContext.getStepData = mockGetStepData;
      mockSafeDeserialize.mockResolvedValue({ result: "success" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpointFn,
        mockCreateStepId,
        mockHasRunningOperations,
        () => new EventEmitter(),
      );

      const result = await invokeHandler("test-function", { test: "data" });

      expect(result).toEqual({ result: "success" });
      expect(mockCheckpointFn.checkpoint).not.toHaveBeenCalled();
      expect(mockSafeDeserialize).toHaveBeenCalledWith(
        expect.anything(),
        '{"result":"success"}',
        "test-step-1",
        undefined,
        mockContext.terminationManager,
        "test-arn",
      );
    });

    it("should handle invoke with name parameter", async () => {
      const mockGetStepData = jest.fn().mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        ChainedInvokeDetails: {
          Result: '{"result":"named"}',
        },
      });

      mockContext.getStepData = mockGetStepData;
      mockSafeDeserialize.mockResolvedValue({ result: "named" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpointFn,
        mockCreateStepId,
        mockHasRunningOperations,
        () => new EventEmitter(),
      );

      const result = await invokeHandler("test-invoke", "test-function", {
        test: "data",
      });

      expect(result).toEqual({ result: "named" });
      expect(mockSafeDeserialize).toHaveBeenCalledWith(
        expect.anything(),
        '{"result":"named"}',
        "test-step-1",
        "test-invoke",
        mockContext.terminationManager,
        "test-arn",
      );
    });

    it("should handle undefined result for void functions", async () => {
      const mockGetStepData = jest.fn().mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        ChainedInvokeDetails: {
          Result: undefined,
        },
      });

      mockContext.getStepData = mockGetStepData;
      mockSafeDeserialize.mockResolvedValue(undefined);

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpointFn,
        mockCreateStepId,
        mockHasRunningOperations,
        () => new EventEmitter(),
      );

      const result = await invokeHandler("test-function", { test: "data" });

      expect(result).toBeUndefined();
      expect(mockSafeDeserialize).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        "test-step-1",
        undefined,
        mockContext.terminationManager,
        "test-arn",
      );
    });

    it.each([
      OperationStatus.FAILED,
      OperationStatus.TIMED_OUT,
      OperationStatus.STOPPED,
    ])("should throw error when operation status is %s", async (status) => {
      const mockGetStepData = jest.fn().mockReturnValue({
        Status: status,
        ChainedInvokeDetails: {
          Error: {
            ErrorMessage: "Lambda function execution failed",
            ErrorType: "ExecutionError",
          },
        },
      });

      mockContext.getStepData = mockGetStepData;

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpointFn,
        mockCreateStepId,
        mockHasRunningOperations,
        () => new EventEmitter(),
      );

      await expect(
        invokeHandler("test-function", { test: "data" }),
      ).rejects.toThrow("Lambda function execution failed");
    });

    it.each([
      OperationStatus.FAILED,
      OperationStatus.TIMED_OUT,
      OperationStatus.STOPPED,
    ])(
      "should throw error with default message when %s status has no error details",
      async (status) => {
        const mockGetStepData = jest.fn().mockReturnValue({
          Status: status,
          ChainedInvokeDetails: {},
        });

        mockContext.getStepData = mockGetStepData;

        const invokeHandler = createInvokeHandler(
          mockContext,
          mockCheckpointFn,
          mockCreateStepId,
          mockHasRunningOperations,
          () => new EventEmitter(),
        );

        await expect(
          invokeHandler("test-function", { test: "data" }),
        ).rejects.toThrow("Invoke failed");
      },
    );

    it("should terminate when operation is still in progress", async () => {
      const mockGetStepData = jest.fn().mockReturnValue({
        Status: OperationStatus.STARTED,
      });

      mockContext.getStepData = mockGetStepData;
      mockHasRunningOperations.mockReturnValue(false); // No other operations running

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpointFn,
        mockCreateStepId,
        mockHasRunningOperations,
        () => new EventEmitter(),
      );

      await expect(
        invokeHandler("test-function", { test: "data" }),
      ).rejects.toThrow("Execution terminated");

      expect(mockLog).toHaveBeenCalledWith(
        "⏳",
        "Invoke test-function still in progress, terminating",
      );
      expect(mockTerminate).toHaveBeenCalledWith(
        mockContext,
        TerminationReason.OPERATION_TERMINATED,
        "test-step-1",
      );
    });

    it("should wait when operation is in progress and other operations are running", async () => {
      const mockGetStepData = jest
        .fn()
        .mockReturnValueOnce({ Status: OperationStatus.STARTED }) // Phase 1
        .mockReturnValueOnce({ Status: OperationStatus.STARTED }) // Phase 2 - first check
        .mockReturnValueOnce({
          Status: OperationStatus.SUCCEEDED,
          ChainedInvokeDetails: { Result: '{"result":"success"}' },
        }); // Phase 2 - after wait

      mockContext.getStepData = mockGetStepData;
      mockHasRunningOperations.mockReturnValue(true); // Other operations running
      mockWaitBeforeContinue.mockResolvedValue({
        reason: "status",
        canTerminate: false,
      });
      mockSafeDeserialize.mockResolvedValue({ result: "success" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpointFn,
        mockCreateStepId,
        mockHasRunningOperations,
        () => new EventEmitter(),
      );

      const result = await invokeHandler("test-function", { test: "data" });

      expect(result).toEqual({ result: "success" });
      expect(mockLog).toHaveBeenCalledWith(
        "⏳",
        "Invoke test-function still in progress, waiting for other operations",
      );
      expect(mockWaitBeforeContinue).toHaveBeenCalledWith(
        expect.objectContaining({
          checkHasRunningOperations: true,
          checkStepStatus: true,
          checkTimer: false,
          stepId: "test-step-1",
          context: mockContext,
          hasRunningOperations: mockHasRunningOperations,
        }),
      );
      expect(mockTerminate).toHaveBeenCalledTimes(0);
    });

    it("should create checkpoint and terminate for new invoke without name and without input", async () => {
      const mockGetStepData = jest
        .fn()
        .mockReturnValueOnce(undefined) // First call - no step data
        .mockReturnValueOnce({ Status: OperationStatus.STARTED }); // After checkpoint

      mockContext.getStepData = mockGetStepData;
      mockHasRunningOperations.mockReturnValue(false); // No other operations running

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpointFn,
        mockCreateStepId,
        mockHasRunningOperations,
        () => new EventEmitter(),
        "parent-123",
      );

      await expect(invokeHandler("test-function")).rejects.toThrow(
        "Execution terminated",
      );

      expect(mockSafeSerialize).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        "test-step-1",
        undefined,
        mockContext.terminationManager,
        "test-arn",
      );

      expect(mockCheckpointFn.checkpoint).toHaveBeenCalledWith("test-step-1", {
        Id: "test-step-1",
        ParentId: "parent-123",
        Action: OperationAction.START,
        SubType: OperationSubType.CHAINED_INVOKE,
        Type: OperationType.CHAINED_INVOKE,
        Name: undefined,
        Payload: '{"serialized":"data"}',
        ChainedInvokeOptions: {
          FunctionName: "test-function",
        },
      });

      expect(mockLog).toHaveBeenCalledWith(
        "🔗",
        "Invoke test-function (test-step-1) - phase 1",
      );
      expect(mockLog).toHaveBeenCalledWith(
        "🚀",
        "Invoke test-function started (phase 1)",
      );
      expect(mockLog).toHaveBeenCalledWith(
        "✅",
        "Invoke phase 1 complete:",
        expect.anything(),
      );
    });

    it("should create checkpoint and terminate for new invoke with name and without input", async () => {
      const mockGetStepData = jest
        .fn()
        .mockReturnValueOnce(undefined) // First call - no step data
        .mockReturnValueOnce({ Status: OperationStatus.STARTED }); // After checkpoint

      mockContext.getStepData = mockGetStepData;
      mockHasRunningOperations.mockReturnValue(false); // No other operations running

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpointFn,
        mockCreateStepId,
        mockHasRunningOperations,
        () => new EventEmitter(),
        "parent-123",
      );

      await expect(invokeHandler("test-name", "test-function")).rejects.toThrow(
        "Execution terminated",
      );

      expect(mockSafeSerialize).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        "test-step-1",
        "test-name",
        mockContext.terminationManager,
        "test-arn",
      );

      expect(mockCheckpointFn.checkpoint).toHaveBeenCalledWith("test-step-1", {
        Id: "test-step-1",
        ParentId: "parent-123",
        Action: OperationAction.START,
        SubType: OperationSubType.CHAINED_INVOKE,
        Type: OperationType.CHAINED_INVOKE,
        Name: "test-name",
        Payload: '{"serialized":"data"}',
        ChainedInvokeOptions: {
          FunctionName: "test-function",
        },
      });

      expect(mockLog).toHaveBeenCalledWith(
        "🔗",
        "Invoke test-name (test-step-1) - phase 1",
      );
      expect(mockLog).toHaveBeenCalledWith(
        "🚀",
        "Invoke test-name started (phase 1)",
      );
      expect(mockLog).toHaveBeenCalledWith(
        "✅",
        "Invoke phase 1 complete:",
        expect.anything(),
      );
    });

    it("should create checkpoint and terminate for new invoke without name", async () => {
      const mockGetStepData = jest
        .fn()
        .mockReturnValueOnce(undefined) // First call - no step data
        .mockReturnValueOnce({ Status: OperationStatus.STARTED }); // After checkpoint

      mockContext.getStepData = mockGetStepData;
      mockHasRunningOperations.mockReturnValue(false); // No other operations running

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpointFn,
        mockCreateStepId,
        mockHasRunningOperations,
        () => new EventEmitter(),
        "parent-123",
      );

      await expect(
        invokeHandler("test-function", { test: "data" }),
      ).rejects.toThrow("Execution terminated");

      expect(mockSafeSerialize).toHaveBeenCalledWith(
        expect.anything(),
        { test: "data" },
        "test-step-1",
        undefined,
        mockContext.terminationManager,
        "test-arn",
      );

      expect(mockCheckpointFn.checkpoint).toHaveBeenCalledWith("test-step-1", {
        Id: "test-step-1",
        ParentId: "parent-123",
        Action: OperationAction.START,
        SubType: OperationSubType.CHAINED_INVOKE,
        Type: OperationType.CHAINED_INVOKE,
        Name: undefined,
        Payload: '{"serialized":"data"}',
        ChainedInvokeOptions: {
          FunctionName: "test-function",
        },
      });

      expect(mockLog).toHaveBeenCalledWith(
        "🚀",
        "Invoke test-function started (phase 1)",
      );
    });

    it("should create checkpoint and terminate for new invoke with name", async () => {
      const mockGetStepData = jest
        .fn()
        .mockReturnValueOnce(undefined) // First call - no step data
        .mockReturnValueOnce({ Status: OperationStatus.STARTED }); // After checkpoint

      mockContext.getStepData = mockGetStepData;
      mockHasRunningOperations.mockReturnValue(false); // No other operations running

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpointFn,
        mockCreateStepId,
        mockHasRunningOperations,
        () => new EventEmitter(),
        "parent-123",
      );

      await expect(
        invokeHandler("my-invoke", "test-function", { test: "data" }),
      ).rejects.toThrow("Execution terminated");

      expect(mockCheckpointFn.checkpoint).toHaveBeenCalledWith("test-step-1", {
        Id: "test-step-1",
        ParentId: "parent-123",
        Action: OperationAction.START,
        SubType: OperationSubType.CHAINED_INVOKE,
        Type: OperationType.CHAINED_INVOKE,
        Name: "my-invoke",
        Payload: '{"serialized":"data"}',
        ChainedInvokeOptions: {
          FunctionName: "test-function",
        },
      });
    });

    it("should handle invoke with options", async () => {
      const mockGetStepData = jest
        .fn()
        .mockReturnValueOnce(undefined) // First call - no step data
        .mockReturnValueOnce({ Status: OperationStatus.STARTED }); // After checkpoint

      mockContext.getStepData = mockGetStepData;
      mockHasRunningOperations.mockReturnValue(false); // No other operations running

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpointFn,
        mockCreateStepId,
        mockHasRunningOperations,
        () => new EventEmitter(),
        "parent-123",
      );

      const config = {
        payloadSerdes: {
          serialize: async (): Promise<string> => "custom",
          deserialize: async (): Promise<object> => ({}),
        },
      };

      await expect(
        invokeHandler("test-function", { test: "data" }, config),
      ).rejects.toThrow("Execution terminated");

      expect(mockCheckpointFn.checkpoint).toHaveBeenCalledWith("test-step-1", {
        Id: "test-step-1",
        ParentId: "parent-123",
        Action: OperationAction.START,
        SubType: OperationSubType.CHAINED_INVOKE,
        Type: OperationType.CHAINED_INVOKE,
        Name: undefined,
        Payload: '{"serialized":"data"}',
        ChainedInvokeOptions: {
          FunctionName: "test-function",
        },
      });
    });
  });
});
