import { createInvokeHandler } from "./invoke-handler";
import { ExecutionContext, OperationSubType } from "../../types";
import {
  OperationStatus,
  OperationType,
  OperationAction,
} from "@aws-sdk/client-lambda";
import { TerminationReason } from "../../termination-manager/types";
import { OperationInterceptor } from "../../mocks/operation-interceptor";

// Mock dependencies
jest.mock("../../utils/checkpoint/checkpoint");
jest.mock("../../utils/termination-helper");
jest.mock("../../mocks/operation-interceptor");
jest.mock("../../utils/logger/logger");
jest.mock("../../errors/serdes-errors/serdes-errors");
jest.mock("../../utils/wait-before-continue/wait-before-continue");

import { terminate } from "../../utils/termination-helper";
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
  let mockOperationInterceptor: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockCreateStepId = jest.fn().mockReturnValue("test-step-1");
    mockHasRunningOperations = jest.fn().mockReturnValue(false);

    // Create a proper checkpoint mock with force method
    mockCheckpointFn = jest.fn().mockResolvedValue(undefined);
    mockCheckpointFn.force = jest.fn().mockResolvedValue(undefined);

    mockContext = {
      executionContextId: "test-context",
      customerHandlerEvent: {},
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
      isLocalMode: false,
      isVerbose: true,
      durableExecutionArn: "test-arn",
      parentId: "parent-123",
      getStepData: jest.fn().mockReturnValue(undefined),
    } as any;

    // Mock OperationInterceptor
    mockOperationInterceptor = {
      execute: jest.fn(),
    };
    (OperationInterceptor.forExecution as jest.Mock).mockReturnValue(
      mockOperationInterceptor,
    );

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
        InvokeDetails: {
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
      );

      const result = await invokeHandler("test-function", { test: "data" });

      expect(result).toEqual({ result: "success" });
      expect(mockCheckpointFn).not.toHaveBeenCalled();
      expect(mockSafeDeserialize).toHaveBeenCalledWith(
        expect.anything(),
        '{"result":"success"}',
        "test-step-1",
        undefined,
        mockContext.terminationManager,
        true,
        "test-arn",
      );
    });

    it("should handle invoke with name parameter", async () => {
      const mockGetStepData = jest.fn().mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        InvokeDetails: {
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
        true,
        "test-arn",
      );
    });

    it("should handle undefined result for void functions", async () => {
      const mockGetStepData = jest.fn().mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        InvokeDetails: {
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
      );

      const result = await invokeHandler("test-function", { test: "data" });

      expect(result).toBeUndefined();
      expect(mockSafeDeserialize).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        "test-step-1",
        undefined,
        mockContext.terminationManager,
        true,
        "test-arn",
      );
    });

    it("should throw error when operation status is FAILED", async () => {
      const mockGetStepData = jest.fn().mockReturnValue({
        Status: OperationStatus.FAILED,
        InvokeDetails: {
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
      );

      await expect(
        invokeHandler("test-function", { test: "data" }),
      ).rejects.toThrow("Lambda function execution failed");
    });

    it("should throw error with default message when FAILED status has no error details", async () => {
      const mockGetStepData = jest.fn().mockReturnValue({
        Status: OperationStatus.FAILED,
        InvokeDetails: {},
      });

      mockContext.getStepData = mockGetStepData;

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpointFn,
        mockCreateStepId,
        mockHasRunningOperations,
      );

      await expect(
        invokeHandler("test-function", { test: "data" }),
      ).rejects.toThrow("Invoke failed");
    });

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
      );

      await expect(
        invokeHandler("test-function", { test: "data" }),
      ).rejects.toThrow("Execution terminated");

      expect(mockLog).toHaveBeenCalledWith(
        true,
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
      const mockGetStepData = jest.fn()
        .mockReturnValueOnce({ Status: OperationStatus.STARTED })
        .mockReturnValueOnce({ Status: OperationStatus.SUCCEEDED, InvokeDetails: { Result: '{"result":"success"}' } });

      mockContext.getStepData = mockGetStepData;
      mockHasRunningOperations.mockReturnValue(true); // Other operations running
      mockWaitBeforeContinue.mockResolvedValue({ reason: "status" });
      mockSafeDeserialize.mockResolvedValue({ result: "success" });

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpointFn,
        mockCreateStepId,
        mockHasRunningOperations,
      );

      const result = await invokeHandler("test-function", { test: "data" });

      expect(result).toEqual({ result: "success" });
      expect(mockLog).toHaveBeenCalledWith(
        true,
        "⏳",
        "Invoke test-function still in progress, waiting for other operations",
      );
      expect(mockWaitBeforeContinue).toHaveBeenCalledWith({
        checkHasRunningOperations: true,
        checkStepStatus: true,
        checkTimer: false,
        stepId: "test-step-1",
        context: mockContext,
        hasRunningOperations: mockHasRunningOperations,
      });
    });

    it("should create checkpoint and terminate for new invoke without name", async () => {
      const mockGetStepData = jest.fn()
        .mockReturnValueOnce(undefined) // First call - no step data
        .mockReturnValueOnce({ Status: OperationStatus.STARTED }); // After checkpoint

      mockContext.getStepData = mockGetStepData;
      mockHasRunningOperations.mockReturnValue(false); // No other operations running

      mockOperationInterceptor.execute.mockImplementation(
        async (name: any, fn: any) => {
          return await fn();
        },
      );

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpointFn,
        mockCreateStepId,
        mockHasRunningOperations,
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
        true,
        "test-arn",
      );

      expect(mockCheckpointFn).toHaveBeenCalledWith("test-step-1", {
        Id: "test-step-1",
        ParentId: "parent-123",
        Action: OperationAction.START,
        SubType: OperationSubType.INVOKE,
        Type: OperationType.INVOKE,
        Name: undefined,
        Payload: '{"serialized":"data"}',
        InvokeOptions: {
          FunctionName: "test-function",
        },
      });

      expect(mockLog).toHaveBeenCalledWith(
        true,
        "🚀",
        "Invoke test-function started, re-checking status",
      );
    });

    it("should create checkpoint and terminate for new invoke with name", async () => {
      const mockGetStepData = jest.fn()
        .mockReturnValueOnce(undefined) // First call - no step data
        .mockReturnValueOnce({ Status: OperationStatus.STARTED }); // After checkpoint

      mockContext.getStepData = mockGetStepData;
      mockHasRunningOperations.mockReturnValue(false); // No other operations running

      mockOperationInterceptor.execute.mockImplementation(
        async (name: any, fn: any) => {
          return await fn();
        },
      );

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpointFn,
        mockCreateStepId,
        mockHasRunningOperations,
      );

      await expect(
        invokeHandler("my-invoke", "test-function", { test: "data" }),
      ).rejects.toThrow("Execution terminated");

      expect(mockCheckpointFn).toHaveBeenCalledWith("test-step-1", {
        Id: "test-step-1",
        ParentId: "parent-123",
        Action: OperationAction.START,
        SubType: OperationSubType.INVOKE,
        Type: OperationType.INVOKE,
        Name: "my-invoke",
        Payload: '{"serialized":"data"}',
        InvokeOptions: {
          FunctionName: "test-function",
        },
      });
    });

    it("should handle invoke with options", async () => {
      const mockGetStepData = jest.fn()
        .mockReturnValueOnce(undefined) // First call - no step data
        .mockReturnValueOnce({ Status: OperationStatus.STARTED }); // After checkpoint

      mockContext.getStepData = mockGetStepData;
      mockHasRunningOperations.mockReturnValue(false); // No other operations running

      mockOperationInterceptor.execute.mockImplementation(
        async (name: any, fn: any) => {
          return await fn();
        },
      );

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpointFn,
        mockCreateStepId,
        mockHasRunningOperations,
      );

      const config = {
        payloadSerdes: {
          serialize: async (): Promise<string> => "custom",
          deserialize: async (): Promise<object> => ({}),
        },
        timeoutSeconds: 30,
      };

      await expect(
        invokeHandler("test-function", { test: "data" }, config),
      ).rejects.toThrow("Execution terminated");

      expect(mockCheckpointFn).toHaveBeenCalledWith("test-step-1", {
        Id: "test-step-1",
        ParentId: "parent-123",
        Action: OperationAction.START,
        SubType: OperationSubType.INVOKE,
        Type: OperationType.INVOKE,
        Name: undefined,
        Payload: '{"serialized":"data"}',
        InvokeOptions: {
          FunctionName: "test-function",
          TimeoutSeconds: 30,
        },
      });
    });
  });
});
