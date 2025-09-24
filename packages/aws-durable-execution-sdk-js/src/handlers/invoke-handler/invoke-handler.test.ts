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

import { terminate } from "../../utils/termination-helper";
import { log } from "../../utils/logger/logger";
import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";

const mockTerminate = terminate as jest.MockedFunction<typeof terminate>;
const mockLog = log as jest.MockedFunction<typeof log>;
const mockSafeSerialize = safeSerialize as jest.MockedFunction<
  typeof safeSerialize
>;
const mockSafeDeserialize = safeDeserialize as jest.MockedFunction<
  typeof safeDeserialize
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

    it("should create checkpoint and terminate for new invoke without name", async () => {
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
        "Invoke test-function started, terminating for async execution",
      );
    });

    it("should create checkpoint and terminate for new invoke with name", async () => {
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
        serdes: {
          serialize: async () => "custom",
          deserialize: async () => ({}),
        },
        TimeoutSeconds: 30,
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

    it("should handle intercepted execution", async () => {
      const interceptedResult = { intercepted: true };
      mockOperationInterceptor.execute.mockResolvedValue(interceptedResult);

      const invokeHandler = createInvokeHandler(
        mockContext,
        mockCheckpointFn,
        mockCreateStepId,
        mockHasRunningOperations,
      );

      const result = await invokeHandler("test-function", { test: "data" });

      expect(result).toBe(interceptedResult);
      expect(OperationInterceptor.forExecution).toHaveBeenCalledWith(
        "test-arn",
      );
      expect(mockOperationInterceptor.execute).toHaveBeenCalledWith(
        undefined,
        expect.any(Function),
      );
    });
  });
});
