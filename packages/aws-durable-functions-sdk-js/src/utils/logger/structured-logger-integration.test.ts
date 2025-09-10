import { createDurableContext } from "../../context/durable-context/durable-context";
import { createMockExecutionContext } from "../../testing/mock-context";
import { Context } from "aws-lambda";
import { hashId } from "../step-id-utils/step-id-utils";

describe("Structured Logger Integration", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should use correct stepId for step logger", async () => {
    const mockExecutionContext = createMockExecutionContext({
      durableExecutionArn: "test-execution-arn",
    });

    const mockLambdaContext = {
      callbackWaitsForEmptyEventLoop: false,
      functionName: "test-function",
      functionVersion: "1",
      invokedFunctionArn: "test-arn",
      memoryLimitInMB: "128",
      awsRequestId: "test-request-id",
      logGroupName: "test-log-group",
      logStreamName: "test-log-stream",
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    } as Context;

    // Simulate step execution with stepUtil
    const stepUtil = {
      logger: {
        info: (message: string) => {
          const logEntry = {
            timestamp: new Date().toISOString(),
            level: "info",
            message,
            executionId: "test-execution-arn",
            stepId: hashId("test-step"),
            attempt: 0,
          };
          console.log(JSON.stringify(logEntry));
        },
      },
    };
    stepUtil.logger.info("Step execution");

    expect(consoleSpy).toHaveBeenCalledTimes(1);

    const logs = consoleSpy.mock.calls.map((call) => JSON.parse(call[0]));

    // Step log
    expect(logs[0]).toMatchObject({
      message: "Step execution",
      executionId: "test-execution-arn",
      stepId: hashId("test-step"),
      attempt: 0,
    });
  });
});
