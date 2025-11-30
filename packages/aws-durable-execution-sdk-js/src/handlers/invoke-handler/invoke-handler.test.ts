import { createInvokeHandler } from "./invoke-handler";
import { ExecutionContext, OperationSubType } from "../../types";
import {
  OperationStatus,
  OperationType,
  OperationAction,
} from "@aws-sdk/client-lambda";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";

jest.mock("../../utils/logger/logger");
jest.mock("../../errors/serdes-errors/serdes-errors");

import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";

const mockSafeSerialize = safeSerialize as jest.MockedFunction<
  typeof safeSerialize
>;
const mockSafeDeserialize = safeDeserialize as jest.MockedFunction<
  typeof safeDeserialize
>;

describe("InvokeHandler", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let mockCreateStepId: jest.Mock;
  let checkAndUpdateReplayMode: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockCreateStepId = jest.fn().mockReturnValue("test-step-1");
    checkAndUpdateReplayMode = jest.fn();

    mockCheckpoint = {
      checkpoint: jest.fn().mockResolvedValue(undefined),
      markOperationState: jest.fn(),
      markOperationAwaited: jest.fn(),
      waitForStatusChange: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockContext = {
      getStepData: jest.fn().mockReturnValue(undefined),
      terminationManager: {
        terminate: jest.fn(),
      },
      durableExecutionArn: "test-arn",
    } as any;

    mockSafeSerialize.mockResolvedValue('{"serialized":"data"}');
    mockSafeDeserialize.mockResolvedValue({ deserialized: "data" });
  });

  describe("invoke", () => {
    it("should return cached result for completed invoke", async () => {
      (mockContext.getStepData as jest.Mock).mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        ChainedInvokeDetails: {
          Result: '{"result":"success"}',
        },
      });

      mockSafeDeserialize.mockResolvedValue({ result: "success" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        undefined,
        checkAndUpdateReplayMode,
      );

      const result = await invokeHandler("test-function", { test: "data" });

      expect(result).toEqual({ result: "success" });
      expect(mockCheckpoint.checkpoint).not.toHaveBeenCalled();
      expect(mockSafeDeserialize).toHaveBeenCalledWith(
        expect.anything(),
        '{"result":"success"}',
        "test-step-1",
        undefined,
        mockContext.terminationManager,
        "test-arn",
      );
      expect(checkAndUpdateReplayMode).toHaveBeenCalled();
    });

    it("should handle invoke with name parameter", async () => {
      (mockContext.getStepData as jest.Mock).mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        ChainedInvokeDetails: {
          Result: '{"result":"named"}',
        },
      });

      mockSafeDeserialize.mockResolvedValue({ result: "named" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
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
      (mockContext.getStepData as jest.Mock).mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        ChainedInvokeDetails: {
          Result: undefined,
        },
      });

      mockSafeDeserialize.mockResolvedValue(undefined);

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
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
      (mockContext.getStepData as jest.Mock).mockReturnValue({
        Status: status,
        ChainedInvokeDetails: {
          Error: {
            ErrorMessage: "Lambda function execution failed",
            ErrorType: "ExecutionError",
          },
        },
      });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
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
        (mockContext.getStepData as jest.Mock).mockReturnValue({
          Status: status,
          ChainedInvokeDetails: {},
        });

        const invokeHandler = createInvokeHandler(
          mockContext,
          mockCheckpoint,
          mockCreateStepId,
        );

        await expect(
          invokeHandler("test-function", { test: "data" }),
        ).rejects.toThrow("Invoke failed");
      },
    );

    it("should wait for status change when operation is still in progress", async () => {
      // Phase 1: first check (null)
      // Phase 2: after waitForStatusChange (SUCCEEDED)
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(null) // Phase 1 - initial check, triggers checkpoint
        .mockReturnValueOnce({
          Status: OperationStatus.SUCCEEDED,
          ChainedInvokeDetails: { Result: '{"result":"success"}' },
        }); // Phase 2 - after waitForStatusChange

      mockSafeDeserialize.mockResolvedValue({ result: "success" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
      );

      const result = await invokeHandler("test-function", { test: "data" });

      expect(result).toEqual({ result: "success" });
      expect(mockCheckpoint.markOperationAwaited).toHaveBeenCalledWith(
        "test-step-1",
      );
      expect(mockCheckpoint.waitForStatusChange).toHaveBeenCalledWith(
        "test-step-1",
      );
    });

    it("should create checkpoint for new invoke without name and without input", async () => {
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue({
          Status: OperationStatus.SUCCEEDED,
          ChainedInvokeDetails: { Result: '{"result":"success"}' },
        });

      mockSafeDeserialize.mockResolvedValue({ result: "success" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        "parent-123",
      );

      const result = await invokeHandler("test-function");

      expect(result).toEqual({ result: "success" });
      expect(mockSafeSerialize).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        "test-step-1",
        undefined,
        mockContext.terminationManager,
        "test-arn",
      );

      expect(mockCheckpoint.checkpoint).toHaveBeenCalledWith("test-step-1", {
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

    it("should create checkpoint for new invoke with name and without input", async () => {
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue({
          Status: OperationStatus.SUCCEEDED,
          ChainedInvokeDetails: { Result: '{"result":"success"}' },
        });

      mockSafeDeserialize.mockResolvedValue({ result: "success" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        "parent-123",
      );

      const result = await invokeHandler("test-name", "test-function");

      expect(result).toEqual({ result: "success" });
      expect(mockSafeSerialize).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        "test-step-1",
        "test-name",
        mockContext.terminationManager,
        "test-arn",
      );

      expect(mockCheckpoint.checkpoint).toHaveBeenCalledWith("test-step-1", {
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
    });

    it("should create checkpoint for new invoke without name", async () => {
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue({
          Status: OperationStatus.SUCCEEDED,
          ChainedInvokeDetails: { Result: '{"result":"success"}' },
        });

      mockSafeDeserialize.mockResolvedValue({ result: "success" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        "parent-123",
      );

      const result = await invokeHandler("test-function", { test: "data" });

      expect(result).toEqual({ result: "success" });
      expect(mockSafeSerialize).toHaveBeenCalledWith(
        expect.anything(),
        { test: "data" },
        "test-step-1",
        undefined,
        mockContext.terminationManager,
        "test-arn",
      );

      expect(mockCheckpoint.checkpoint).toHaveBeenCalledWith("test-step-1", {
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

    it("should create checkpoint for new invoke with name", async () => {
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue({
          Status: OperationStatus.SUCCEEDED,
          ChainedInvokeDetails: { Result: '{"result":"success"}' },
        });

      mockSafeDeserialize.mockResolvedValue({ result: "success" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        "parent-123",
      );

      const result = await invokeHandler("my-invoke", "test-function", {
        test: "data",
      });

      expect(result).toEqual({ result: "success" });
      expect(mockCheckpoint.checkpoint).toHaveBeenCalledWith("test-step-1", {
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

    it("should handle invoke with custom serdes", async () => {
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue({
          Status: OperationStatus.SUCCEEDED,
          ChainedInvokeDetails: { Result: '{"result":"success"}' },
        });

      mockSafeDeserialize.mockResolvedValue({ result: "success" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        "parent-123",
      );

      const config = {
        payloadSerdes: {
          serialize: jest.fn().mockResolvedValue("custom"),
          deserialize: jest.fn().mockResolvedValue({}),
        },
      };

      const result = await invokeHandler(
        "test-function",
        { test: "data" },
        config,
      );

      expect(result).toEqual({ result: "success" });
      expect(mockCheckpoint.checkpoint).toHaveBeenCalledWith("test-step-1", {
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
