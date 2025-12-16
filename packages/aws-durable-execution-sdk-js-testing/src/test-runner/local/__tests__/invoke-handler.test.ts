import { Context } from "aws-lambda";
import {
  DurableExecutionInvocationInput,
  DurableExecutionInvocationInputWithClient,
  DurableExecutionInvocationOutput,
  InvocationStatus,
} from "@aws/durable-execution-sdk-js";
import { HandlerParameters, InvokeHandler } from "../invoke-handler";
import { LocalRunnerClient } from "../local-runner-storage";

// Mock crypto
jest.mock("node:crypto", () => ({
  randomUUID: jest.fn().mockReturnValue("00000000-0000-0000-0000-000000000000"),
}));

describe("invoke-handler", () => {
  describe("InvokeHandler class", () => {
    let invokeHandlerInstance: InvokeHandler;

    beforeEach(() => {
      invokeHandlerInstance = new InvokeHandler();
    });

    it("should create instance with default context values", () => {
      expect(invokeHandlerInstance).toBeInstanceOf(InvokeHandler);
    });

    it("should call handler with proper parameters", async () => {
      const mockHandler = jest
        .fn<
          Promise<DurableExecutionInvocationOutput>,
          [DurableExecutionInvocationInput]
        >()
        .mockResolvedValue({
          Status: InvocationStatus.SUCCEEDED,
          Result: "test-result",
        });

      const params: HandlerParameters = {
        durableExecutionArn: "test-arn",
        operations: [
          {
            Id: "op1",
            Name: "testOp",
            Type: undefined,
            StartTimestamp: undefined,
            Status: undefined,
          },
        ],
        checkpointToken: "test-token",
      };

      const result = await invokeHandlerInstance.invoke(mockHandler, params);

      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          CheckpointToken: "test-token",
          DurableExecutionArn: "test-arn",
          InitialExecutionState: {
            Operations: params.operations,
            NextMarker: "",
          },
          durableExecutionClient: expect.any(LocalRunnerClient),
        }),
        expect.objectContaining({
          functionName: "my-function-name",
          awsRequestId: "00000000-0000-0000-0000-000000000000",
        }),
      );
      expect(mockHandler).toHaveBeenCalledWith(
        expect.any(DurableExecutionInvocationInputWithClient),
        expect.any(Object),
      );
      expect(mockHandler).toHaveBeenCalledTimes(1);

      expect(result).toEqual({
        Status: InvocationStatus.SUCCEEDED,
        Result: "test-result",
      });
    });

    it("should merge custom context values with default context", async () => {
      const mockHandler = jest.fn().mockResolvedValue({
        Status: InvocationStatus.SUCCEEDED,
        Result: "test-result",
      });

      const customContextValues: Partial<Context> = {
        functionName: "custom-function-name",
        awsRequestId: "custom-request-id",
        getRemainingTimeInMillis: () => 5000,
      };

      const params: HandlerParameters = {
        durableExecutionArn: "test-arn",
        operations: [
          {
            Id: "op1",
            Name: "testOp",
            Type: undefined,
            StartTimestamp: undefined,
            Status: undefined,
          },
        ],
        checkpointToken: "test-token",
        contextValues: customContextValues,
      };

      await invokeHandlerInstance.invoke(mockHandler, params);

      expect(mockHandler).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          functionName: "custom-function-name",
          awsRequestId: "custom-request-id",
          getRemainingTimeInMillis:
            customContextValues.getRemainingTimeInMillis,
        }),
      );
    });

    it("should accept custom default context values in constructor", async () => {
      const customDefaults: Partial<Context> = {
        functionName: "constructor-custom-name",
        memoryLimitInMB: "512",
      };

      const customInvokeHandler = new InvokeHandler(customDefaults);
      const mockHandler = jest.fn().mockResolvedValue({
        Status: InvocationStatus.SUCCEEDED,
        Result: "test-result",
      });

      const params: HandlerParameters = {
        durableExecutionArn: "test-arn",
        operations: [],
        checkpointToken: "test-token",
      };

      await customInvokeHandler.invoke(mockHandler, params);

      expect(mockHandler).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          functionName: "constructor-custom-name",
          memoryLimitInMB: "512",
        }),
      );
    });

    it("should throw error if handler throws", async () => {
      const mockError = new Error("Handler error");
      const mockHandler = jest.fn().mockRejectedValue(mockError);

      const params: HandlerParameters = {
        durableExecutionArn: "test-arn",
        operations: [
          {
            Id: "op1",
            Name: "testOp",
            Type: undefined,
            StartTimestamp: undefined,
            Status: undefined,
          },
        ],
        checkpointToken: "test-token",
      };

      await expect(
        invokeHandlerInstance.invoke(mockHandler, params),
      ).rejects.toThrow(mockError);
    });
  });

  describe("buildContext method", () => {
    let invokeHandlerInstance: InvokeHandler;

    beforeEach(() => {
      invokeHandlerInstance = new InvokeHandler();
    });

    it("should return default context when no contextValues provided", () => {
      const context = invokeHandlerInstance.buildContext();

      expect(context).toMatchObject({
        callbackWaitsForEmptyEventLoop: false,
        functionName: "my-function-name",
        functionVersion: "1",
        memoryLimitInMB: "1024",
        awsRequestId: "00000000-0000-0000-0000-000000000000",
        logGroupName: "MyLogGroupName",
        logStreamName: "MyLogStreamName",
      });
      expect(typeof context.getRemainingTimeInMillis).toBe("function");
    });

    it("should merge custom context values with defaults", () => {
      const customContextValues: Partial<Context> = {
        functionName: "custom-function-name",
        memoryLimitInMB: "512",
        awsRequestId: "custom-request-id",
      };

      const context = invokeHandlerInstance.buildContext(customContextValues);

      expect(context).toMatchObject({
        functionName: "custom-function-name",
        memoryLimitInMB: "512",
        awsRequestId: "custom-request-id",
        // Defaults should still be present
        callbackWaitsForEmptyEventLoop: false,
        functionVersion: "1",
        logGroupName: "MyLogGroupName",
        logStreamName: "MyLogStreamName",
      });
    });

    it("should override function implementations in context", () => {
      const customGetRemainingTime = jest.fn().mockReturnValue(5000);

      const customContextValues: Partial<Context> = {
        getRemainingTimeInMillis: customGetRemainingTime,
      };

      const context = invokeHandlerInstance.buildContext(customContextValues);

      expect(context.getRemainingTimeInMillis).toBe(customGetRemainingTime);
      expect(context.getRemainingTimeInMillis()).toBe(5000);
      expect(customGetRemainingTime).toHaveBeenCalled();
    });

    it("should handle constructor defaults and runtime overrides together", () => {
      const constructorDefaults: Partial<Context> = {
        functionName: "constructor-function",
        memoryLimitInMB: "256",
      };

      const handlerWithDefaults = new InvokeHandler(constructorDefaults);

      const runtimeOverrides: Partial<Context> = {
        functionName: "runtime-function", // Should override constructor default
        awsRequestId: "runtime-request-id",
      };

      const context = handlerWithDefaults.buildContext(runtimeOverrides);

      expect(context).toMatchObject({
        functionName: "runtime-function", // Runtime override wins
        memoryLimitInMB: "256", // Constructor default preserved
        awsRequestId: "runtime-request-id", // Runtime override
      });
    });
  });
});
