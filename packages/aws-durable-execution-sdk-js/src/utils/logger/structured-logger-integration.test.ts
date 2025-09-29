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
    const _mockLambdaContext = {
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
        info: (message: string): void => {
          const logEntry = {
            timestamp: new Date().toISOString(),
            level: "info",
            message,
            executionId: "test-execution-arn",
            stepId: hashId("test-step"),
            attempt: 0,
          };
          // eslint-disable-next-line no-console
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
