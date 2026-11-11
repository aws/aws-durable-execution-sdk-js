import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";
import { createInvokeHandler } from "./invoke-handler";
import {
  ExecutionContext,
  OperationLifecycleState,
  OperationSubType,
} from "../../types";
import {
  OperationStatus,
  OperationType,
  OperationAction,
} from "../../types/wire";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { InvokeError } from "../../errors/durable-error/durable-error";

// A fake Serdes. The handler passes it to the real safeSerialize and
// safeDeserialize, so the tests stub and assert on its methods.
let fakeSerdes: { serialize: Mock; deserialize: Mock };
const getFakeSerdes = () => fakeSerdes;

describe("InvokeHandler", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let mockCreateStepId: Mock;
  let checkAndUpdateReplayMode: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeSerdes = { serialize: vi.fn(), deserialize: vi.fn() };

    mockCreateStepId = vi.fn().mockReturnValue("test-step-1");
    checkAndUpdateReplayMode = vi.fn();

    mockCheckpoint = {
      checkpoint: vi.fn().mockResolvedValue(undefined),
      markOperationState: vi.fn(),
      markOperationAwaited: vi.fn(),
      waitForStatusChange: vi.fn().mockResolvedValue(undefined),
    } as any;

    mockContext = {
      getStepData: vi.fn().mockReturnValue(undefined),
      terminationManager: {
        terminate: vi.fn(),
      },
      durableExecutionArn: "test-arn",
      isOperationUpdatedBetweenInvocation: vi.fn().mockReturnValue(false),
    } as any;

    fakeSerdes.serialize.mockResolvedValue('{"serialized":"data"}');
    fakeSerdes.deserialize.mockResolvedValue({ deserialized: "data" });
  });

  describe("invoke", () => {
    it("should return cached result for completed invoke", async () => {
      (mockContext.getStepData as Mock).mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        ChainedInvokeDetails: {
          Result: '{"result":"success"}',
        },
      });

      fakeSerdes.deserialize.mockResolvedValue({ result: "success" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        undefined,
        checkAndUpdateReplayMode,
        getFakeSerdes,
      );

      const result = await invokeHandler("test-function", { test: "data" });

      expect(result).toEqual({ result: "success" });
      expect(mockCheckpoint.checkpoint).not.toHaveBeenCalled();
      expect(fakeSerdes.deserialize).toHaveBeenCalledWith(
        '{"result":"success"}',
        { entityId: "test-step-1", durableExecutionArn: "test-arn" },
      );
      expect(checkAndUpdateReplayMode).toHaveBeenCalled();
    });

    it("should handle invoke with name parameter", async () => {
      (mockContext.getStepData as Mock).mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        ChainedInvokeDetails: {
          Result: '{"result":"named"}',
        },
      });

      fakeSerdes.deserialize.mockResolvedValue({ result: "named" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        undefined,
        undefined,
        getFakeSerdes,
      );

      const result = await invokeHandler("test-invoke", "test-function", {
        test: "data",
      });

      expect(result).toEqual({ result: "named" });
      expect(fakeSerdes.deserialize).toHaveBeenCalledWith(
        '{"result":"named"}',
        { entityId: "test-step-1", durableExecutionArn: "test-arn" },
      );
    });

    it("should handle undefined result for void functions", async () => {
      (mockContext.getStepData as Mock).mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        ChainedInvokeDetails: {
          Result: undefined,
        },
      });

      fakeSerdes.deserialize.mockResolvedValue(undefined);

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        undefined,
        undefined,
        getFakeSerdes,
      );

      const result = await invokeHandler("test-function", { test: "data" });

      expect(result).toBeUndefined();
      expect(fakeSerdes.deserialize).toHaveBeenCalledWith(undefined, {
        entityId: "test-step-1",
        durableExecutionArn: "test-arn",
      });
    });

    it.each([
      OperationStatus.FAILED,
      OperationStatus.TIMED_OUT,
      OperationStatus.STOPPED,
    ])("should throw error when operation status is %s", async (status) => {
      (mockContext.getStepData as Mock).mockReturnValue({
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
        undefined,
        undefined,
        getFakeSerdes,
      );

      await expect(
        invokeHandler("test-function", { test: "data" }),
      ).rejects.toThrow("Lambda function execution failed");
    });

    it.each([
      {
        path: "already completed (replay)",
        stepData: (failed: object) => [failed],
      },
      {
        path: "completed while waiting (live)",
        stepData: (failed: object) => [
          null,
          { Status: OperationStatus.STARTED, ChainedInvokeDetails: {} },
          failed,
        ],
      },
    ])(
      "names the cause after the invoked function's error type when $path",
      async ({ stepData }) => {
        const failed = {
          Status: OperationStatus.FAILED,
          ChainedInvokeDetails: {
            Error: {
              ErrorMessage: "card declined",
              ErrorType: "PaymentError",
              ErrorData: "data",
              StackTrace: ["PaymentError: card declined", "    at remote"],
            },
          },
        };
        const mock = mockContext.getStepData as Mock;
        for (const value of stepData(failed)) mock.mockReturnValueOnce(value);
        mock.mockReturnValue(failed);

        const invokeHandler = createInvokeHandler(
          mockContext,
          mockCheckpoint,
          mockCreateStepId,
          undefined,
          undefined,
          getFakeSerdes,
        );

        const caught = await invokeHandler("test-function", {}).catch(
          (e: unknown) => e,
        );
        expect(caught).toBeInstanceOf(InvokeError);
        expect(caught).toMatchObject({
          message: "card declined",
          errorData: "data",
          cause: {
            name: "PaymentError",
            message: "card declined",
            stack: "PaymentError: card declined\n    at remote",
          },
        });
      },
    );

    it.each([
      [{ ErrorMessage: "boom" }, "Error"],
      [{ ErrorType: "PaymentError" }, "PaymentError"],
    ])("names the cause %j as %s", async (error, expectedName) => {
      (mockContext.getStepData as Mock).mockReturnValue({
        Status: OperationStatus.FAILED,
        ChainedInvokeDetails: { Error: error },
      });
      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        undefined,
        undefined,
        getFakeSerdes,
      );
      const caught = await invokeHandler("test-function", {}).catch(
        (e: unknown) => e,
      );
      expect(caught).toBeInstanceOf(InvokeError);
      expect((caught as InvokeError).cause?.name).toBe(expectedName);
    });

    it("creates no cause when the error has neither a message nor a type", async () => {
      (mockContext.getStepData as Mock).mockReturnValue({
        Status: OperationStatus.FAILED,
        ChainedInvokeDetails: { Error: { ErrorData: "d" } },
      });
      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        undefined,
        undefined,
        getFakeSerdes,
      );
      const caught = await invokeHandler("test-function", {}).catch(
        (e: unknown) => e,
      );
      expect(caught).toBeInstanceOf(InvokeError);
      expect((caught as InvokeError).cause).toBeUndefined();
      expect((caught as InvokeError).message).toBe("Invoke failed");
    });

    it.each([
      OperationStatus.FAILED,
      OperationStatus.TIMED_OUT,
      OperationStatus.STOPPED,
    ])(
      "should throw error with default message when %s status has no error details",
      async (status) => {
        (mockContext.getStepData as Mock).mockReturnValue({
          Status: status,
          ChainedInvokeDetails: {},
        });

        const invokeHandler = createInvokeHandler(
          mockContext,
          mockCheckpoint,
          mockCreateStepId,
          undefined,
          undefined,
          getFakeSerdes,
        );

        await expect(
          invokeHandler("test-function", { test: "data" }),
        ).rejects.toThrow("Invoke failed");
      },
    );

    it("should wait for status change when operation is still in progress", async () => {
      // Phase 1: first check (null)
      // After checkpoint: STARTED
      // Phase 2: after waitForStatusChange (SUCCEEDED)
      (mockContext.getStepData as Mock)
        .mockReturnValueOnce(null) // Phase 1 - initial check, triggers checkpoint
        .mockReturnValueOnce({
          Status: OperationStatus.STARTED,
          ChainedInvokeDetails: {},
        }) // After checkpoint - for plugin onOperationStart
        .mockReturnValueOnce({
          Status: OperationStatus.SUCCEEDED,
          ChainedInvokeDetails: { Result: '{"result":"success"}' },
        }); // Phase 2 - after waitForStatusChange

      fakeSerdes.deserialize.mockResolvedValue({ result: "success" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        undefined,
        undefined,
        getFakeSerdes,
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

    it("keeps the invoke EXECUTING until a result that arrived during the invocation is deserialized", async () => {
      (mockContext.getStepData as Mock)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({
          Status: OperationStatus.STARTED,
          ChainedInvokeDetails: {},
        })
        .mockReturnValueOnce({
          Status: OperationStatus.SUCCEEDED,
          ChainedInvokeDetails: { Result: '{"result":"success"}' },
        });

      // Record the last lifecycle state set before deserialization finishes.
      let stateDuringDeserialize: unknown;
      fakeSerdes.deserialize.mockImplementation(async () => {
        const calls = (mockCheckpoint.markOperationState as Mock).mock.calls;
        stateDuringDeserialize = calls[calls.length - 1][1];
        return { result: "success" };
      });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        undefined,
        undefined,
        getFakeSerdes,
      );

      await invokeHandler("test-function", { test: "data" });

      expect(stateDuringDeserialize).toBe(OperationLifecycleState.EXECUTING);
      const calls = (mockCheckpoint.markOperationState as Mock).mock.calls;
      expect(calls[calls.length - 1]).toEqual([
        "test-step-1",
        OperationLifecycleState.COMPLETED,
      ]);
    });

    it("should create checkpoint for new invoke without name and without input", async () => {
      (mockContext.getStepData as Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue({
          Status: OperationStatus.SUCCEEDED,
          ChainedInvokeDetails: { Result: '{"result":"success"}' },
        });

      fakeSerdes.deserialize.mockResolvedValue({ result: "success" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        "parent-123",
        undefined,
        getFakeSerdes,
      );

      const result = await invokeHandler("test-function");

      expect(result).toEqual({ result: "success" });
      expect(fakeSerdes.serialize).toHaveBeenCalledWith(undefined, {
        entityId: "test-step-1",
        durableExecutionArn: "test-arn",
      });

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
      (mockContext.getStepData as Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue({
          Status: OperationStatus.SUCCEEDED,
          ChainedInvokeDetails: { Result: '{"result":"success"}' },
        });

      fakeSerdes.deserialize.mockResolvedValue({ result: "success" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        "parent-123",
        undefined,
        getFakeSerdes,
      );

      const result = await invokeHandler("test-name", "test-function");

      expect(result).toEqual({ result: "success" });
      expect(fakeSerdes.serialize).toHaveBeenCalledWith(undefined, {
        entityId: "test-step-1",
        durableExecutionArn: "test-arn",
      });

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
      (mockContext.getStepData as Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue({
          Status: OperationStatus.SUCCEEDED,
          ChainedInvokeDetails: { Result: '{"result":"success"}' },
        });

      fakeSerdes.deserialize.mockResolvedValue({ result: "success" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        "parent-123",
        undefined,
        getFakeSerdes,
      );

      const result = await invokeHandler("test-function", { test: "data" });

      expect(result).toEqual({ result: "success" });
      expect(fakeSerdes.serialize).toHaveBeenCalledWith(
        { test: "data" },
        { entityId: "test-step-1", durableExecutionArn: "test-arn" },
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
      (mockContext.getStepData as Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue({
          Status: OperationStatus.SUCCEEDED,
          ChainedInvokeDetails: { Result: '{"result":"success"}' },
        });

      fakeSerdes.deserialize.mockResolvedValue({ result: "success" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        "parent-123",
        undefined,
        getFakeSerdes,
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

    it("should pass tenantId through ChainedInvokeOptions when provided", async () => {
      (mockContext.getStepData as Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue({
          Status: OperationStatus.SUCCEEDED,
          ChainedInvokeDetails: { Result: '{"result":"success"}' },
        });

      fakeSerdes.deserialize.mockResolvedValue({ result: "success" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        "parent-123",
        undefined,
        getFakeSerdes,
      );

      const result = await invokeHandler(
        "test-function",
        { test: "data" },
        { tenantId: "tenant-abc-123" },
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
          TenantId: "tenant-abc-123",
        },
      });
    });

    it("should not include TenantId in ChainedInvokeOptions when not provided", async () => {
      (mockContext.getStepData as Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue({
          Status: OperationStatus.SUCCEEDED,
          ChainedInvokeDetails: { Result: '{"result":"success"}' },
        });

      fakeSerdes.deserialize.mockResolvedValue({ result: "success" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        "parent-123",
        undefined,
        getFakeSerdes,
      );

      await invokeHandler("test-function", { test: "data" });

      const checkpointCall = (mockCheckpoint.checkpoint as Mock).mock
        .calls[0][1];
      expect(checkpointCall.ChainedInvokeOptions).toEqual({
        FunctionName: "test-function",
      });
      expect(checkpointCall.ChainedInvokeOptions).not.toHaveProperty(
        "TenantId",
      );
    });

    it("should handle invoke with custom serdes", async () => {
      (mockContext.getStepData as Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue({
          Status: OperationStatus.SUCCEEDED,
          ChainedInvokeDetails: { Result: '{"result":"success"}' },
        });

      fakeSerdes.deserialize.mockResolvedValue({ result: "success" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpoint,
        mockCreateStepId,
        "parent-123",
        undefined,
        getFakeSerdes,
      );

      const config = {
        payloadSerdes: {
          serialize: vi.fn().mockResolvedValue("custom"),
          deserialize: vi.fn().mockResolvedValue({}),
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
        Payload: "custom",
        ChainedInvokeOptions: {
          FunctionName: "test-function",
        },
      });
      expect(config.payloadSerdes.serialize).toHaveBeenCalledWith(
        { test: "data" },
        { entityId: "test-step-1", durableExecutionArn: "test-arn" },
      );
      expect(fakeSerdes.serialize).not.toHaveBeenCalled();
    });
  });
});
