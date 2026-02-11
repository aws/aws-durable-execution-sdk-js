import { DurableContextImpl } from "./durable-context";
import { ExecutionContext, DurableExecutionMode } from "../../types/core";
import { Context } from "aws-lambda";

describe("DurableContext executionContext property", () => {
  it("should expose durableExecutionArn in executionContext property", () => {
    const DurableExecutionArn =
      "arn:aws:lambda:us-east-1:123456789012:function:f1:$LATEST/durable-execution/execution-name";

    const mockExecutionContext: ExecutionContext = {
      durableExecutionArn: DurableExecutionArn,
      durableExecutionClient: {} as any,
      _stepData: {},
      terminationManager: {} as any,
      requestId: "test-request-id",
      tenantId: undefined,
      pendingCompletions: new Set(),
      getStepData: jest.fn(),
    };

    const mockLambdaContext: Context = {
      callbackWaitsForEmptyEventLoop: false,
      functionName: "test-function",
      functionVersion: "1",
      invokedFunctionArn:
        "arn:aws:lambda:us-east-1:123456789012:function:test-function:1",
      memoryLimitInMB: "128",
      awsRequestId: "test-request-id",
      logGroupName: "/aws/lambda/test-function",
      logStreamName: "2024/01/01/[$LATEST]abcdef123456",
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    };

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const mockDurableExecution = {
      checkpointManager: {} as any,
    };

    const context = new DurableContextImpl(
      mockExecutionContext,
      mockLambdaContext,
      DurableExecutionMode.ExecutionMode,
      mockLogger as any,
      undefined,
      mockDurableExecution as any,
    );

    expect(context.executionContext).toBeDefined();
    expect(context.executionContext.durableExecutionArn).toBe(
      DurableExecutionArn,
    );
  });
});
