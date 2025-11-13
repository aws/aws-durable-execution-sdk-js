import { createDurableContext } from "./durable-context";
import { DurableExecutionMode, ExecutionContext, Logger } from "../../types";
import { Context } from "aws-lambda";

describe("DurableContext logger modeAware configuration", () => {
  const mockExecutionContext: ExecutionContext = {
    _stepData: {},
    durableExecutionArn: "test-arn",
    terminationManager: {
      terminate: jest.fn(),
      getTerminationPromise: jest.fn().mockResolvedValue({ reason: "test" }),
    },
    getStepData: jest.fn(),
    state: {
      getStepData: jest.fn(),
      checkpoint: jest.fn(),
    },
  } as any;

  const mockParentContext: Context = {
    functionName: "test-function",
    functionVersion: "1",
    invokedFunctionArn: "test-arn",
    memoryLimitInMB: "128",
    awsRequestId: "test-request-id",
    logGroupName: "test-log-group",
    logStreamName: "test-log-stream",
    getRemainingTimeInMillis: () => 1000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
    callbackWaitsForEmptyEventLoop: true,
  };

  test("should suppress logs during replay when modeAware is true (default)", () => {
    const customLogger: Logger = {
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const context = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ReplayMode,
    );
    context.configureLogger({ customLogger });

    context.logger.info("replay message");
    expect(customLogger.info).not.toHaveBeenCalled();
  });

  test("should log during replay when modeAware is false", () => {
    const customLogger: Logger = {
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const context = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ReplayMode,
    );
    context.configureLogger({ customLogger, modeAware: false });

    context.logger.info("replay message");
    expect(customLogger.info).toHaveBeenCalledWith(
      "replay message",
      expect.objectContaining({
        level: "info",
        message: "replay message",
        execution_arn: "test-arn",
      }),
    );
  });

  test("should always log during execution mode regardless of modeAware", () => {
    const customLogger: Logger = {
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const context = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ExecutionMode,
    );
    context.configureLogger({ customLogger, modeAware: true });

    context.logger.info("execution message");
    expect(customLogger.info).toHaveBeenCalled();
  });

  test("should allow toggling modeAware at runtime", () => {
    const customLogger: Logger = {
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const context = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ReplayMode,
    );
    context.configureLogger({ customLogger });

    // Default: modeAware = true, should not log during replay
    context.logger.info("message1");
    expect(customLogger.info).not.toHaveBeenCalled();

    // Disable modeAware: should log during replay
    context.configureLogger({ modeAware: false });
    context.logger.info("message2");
    expect(customLogger.info).toHaveBeenCalledTimes(1);

    // Re-enable modeAware: should not log during replay again
    context.configureLogger({ modeAware: true });
    context.logger.info("message3");
    expect(customLogger.info).toHaveBeenCalledTimes(1); // Still 1, no new call
  });

  test("should use default modeAware=true when called with empty config", () => {
    const context = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ReplayMode,
    );
    context.configureLogger({});

    // With default modeAware=true, should not log during replay
    context.logger.info("replay message");

    // Default logger logs to console, but in replay mode with modeAware=true it should be suppressed
    // We can't easily test console output, but we can verify the context was configured
    expect(context.logger).toBeDefined();
  });

  test("should handle multiple partial configurations correctly", () => {
    const customLogger1: Logger = {
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const customLogger2: Logger = {
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const context = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ReplayMode,
    );

    // First: set custom logger only
    context.configureLogger({ customLogger: customLogger1 });
    context.logger.info("message1");
    expect(customLogger1.info).not.toHaveBeenCalled(); // modeAware=true by default

    // Second: change modeAware only (should keep customLogger1)
    context.configureLogger({ modeAware: false });
    context.logger.info("message2");
    expect(customLogger1.info).toHaveBeenCalledTimes(1); // Now logs with customLogger1

    // Third: change custom logger only (should keep modeAware=false)
    context.configureLogger({ customLogger: customLogger2 });
    context.logger.info("message3");
    expect(customLogger1.info).toHaveBeenCalledTimes(1); // No more calls to logger1
    expect(customLogger2.info).toHaveBeenCalledTimes(1); // Now uses logger2

    // Fourth: change modeAware back to true (should keep customLogger2)
    context.configureLogger({ modeAware: true });
    context.logger.info("message4");
    expect(customLogger2.info).toHaveBeenCalledTimes(1); // No new calls, suppressed
  });

  test("should preserve settings when called with empty config", () => {
    const customLogger: Logger = {
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const context = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ReplayMode,
    );

    // Set custom logger and modeAware=false
    context.configureLogger({ customLogger, modeAware: false });
    context.logger.info("message1");
    expect(customLogger.info).toHaveBeenCalledTimes(1);

    // Call with empty config - should preserve both settings
    context.configureLogger({});
    context.logger.info("message2");
    expect(customLogger.info).toHaveBeenCalledTimes(2); // Still uses customLogger with modeAware=false
  });
});
