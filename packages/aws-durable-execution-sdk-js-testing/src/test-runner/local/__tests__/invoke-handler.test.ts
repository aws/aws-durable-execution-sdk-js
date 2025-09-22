import { Context } from "aws-lambda";
import { Operation } from "@aws-sdk/client-lambda";
import {
  DurableExecutionInvocationInput,
  DurableExecutionInvocationOutput,
  InvocationStatus,
} from "aws-durable-execution-sdk-js";
import { HandlerParameters, InvokeHandler } from "../invoke-handler";

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
        operations: [{ id: "op1", name: "testOp" } as Operation],
        checkpointToken: "test-token",
      };

      const result = await invokeHandlerInstance.invoke(mockHandler, params);

      expect(mockHandler).toHaveBeenCalledWith(
        {
          CheckpointToken: "test-token",
          DurableExecutionArn: "test-arn",
          InitialExecutionState: {
            Operations: params.operations,
            NextMarker: "",
          },
        },
        expect.objectContaining({
          functionName: "my-function-name",
          awsRequestId: "00000000-0000-0000-0000-000000000000",
        })
      );

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
        operations: [{ id: "op1", name: "testOp" } as Operation],
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
        })
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
        })
      );
    });

    it("should throw error if handler throws", async () => {
      const mockError = new Error("Handler error");
      const mockHandler = jest.fn().mockRejectedValue(mockError);

      const params: HandlerParameters = {
        durableExecutionArn: "test-arn",
        operations: [{ id: "op1", name: "testOp" } as Operation],
        checkpointToken: "test-token",
      };

      await expect(
        invokeHandlerInstance.invoke(mockHandler, params)
      ).rejects.toThrow(mockError);
    });
  });
});
