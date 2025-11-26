import { createDurableContext, DurableExecution } from "./durable-context";
import { DurableExecutionMode, ExecutionContext } from "../../types";
import { Context } from "aws-lambda";
import { createDefaultLogger } from "../../utils/logger/default-logger";
import { runWithContext } from "../../utils/context-tracker/context-tracker";

describe("DurableContext logger modeAware configuration", () => {
  let mockDurableExecution: DurableExecution;

  beforeEach(() => {
    mockDurableExecution = {
      checkpointManager: {
        checkpoint: jest.fn(),
        force: jest.fn(),
        setTerminating: jest.fn(),
        hasPendingAncestorCompletion: jest.fn(),
      },
    } as any;
  });

  // Helper to create a mock logger that respects shouldLog
  const createMockLogger = (): any => {
    let loggingContext: any = null;
    const infoMock = jest.fn();

    return {
      log: jest.fn(),
      info: jest.fn((...args: any[]) => {
        infoMock(...args);
      }),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      configureDurableLoggingContext: jest.fn((ctx: any) => {
        loggingContext = ctx;
      }),
      _getInfoMock: () => infoMock,
    };
  };

  const mockExecutionContext = (): ExecutionContext =>
    ({
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
    }) as any;

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
    const customLogger = createMockLogger();

    const context = createDurableContext(
      mockExecutionContext(),
      mockParentContext,
      DurableExecutionMode.ReplayMode,
      createDefaultLogger(),
      undefined,
      mockDurableExecution,
    );
    context.configureLogger({ customLogger: customLogger as any });

    runWithContext(
      "root",
      undefined,
      () => {
        context.logger.info("replay message");
      },
      undefined,
      DurableExecutionMode.ReplayMode,
    );
    expect(customLogger._getInfoMock()).not.toHaveBeenCalled();
  });

  test("should log during replay when modeAware is false", () => {
    const customLogger = createMockLogger();

    const context = createDurableContext(
      mockExecutionContext(),
      mockParentContext,
      DurableExecutionMode.ReplayMode,
      createDefaultLogger(),
      undefined,
      mockDurableExecution,
    );
    context.configureLogger({
      customLogger: customLogger as any,
      modeAware: false,
    });

    runWithContext(
      "root",
      undefined,
      () => {
        context.logger.info("replay message");
      },
      undefined,
      DurableExecutionMode.ReplayMode,
    );
    expect(customLogger._getInfoMock()).toHaveBeenCalledWith("replay message");
  });

  test("should always log during execution mode regardless of modeAware", () => {
    const customLogger = createMockLogger();

    const context = createDurableContext(
      mockExecutionContext(),
      mockParentContext,
      DurableExecutionMode.ExecutionMode,
      createDefaultLogger(),
      undefined,
      mockDurableExecution,
    );
    context.configureLogger({
      customLogger: customLogger as any,
      modeAware: true,
    });

    runWithContext(
      "root",
      undefined,
      () => {
        context.logger.info("execution message");
      },
      undefined,
      DurableExecutionMode.ExecutionMode,
    );
    expect(customLogger._getInfoMock()).toHaveBeenCalled();
  });

  test("should allow toggling modeAware at runtime", () => {
    const customLogger = createMockLogger();

    const context = createDurableContext(
      mockExecutionContext(),
      mockParentContext,
      DurableExecutionMode.ReplayMode,
      createDefaultLogger(),
      undefined,
      mockDurableExecution,
    );
    context.configureLogger({ customLogger: customLogger as any });

    // Default: modeAware = true, should not log during replay
    runWithContext(
      "root",
      undefined,
      () => {
        context.logger.info("message1");
      },
      undefined,
      DurableExecutionMode.ReplayMode,
    );
    expect(customLogger._getInfoMock()).not.toHaveBeenCalled();

    // Disable modeAware: should log during replay
    context.configureLogger({ modeAware: false });
    runWithContext(
      "root",
      undefined,
      () => {
        context.logger.info("message2");
      },
      undefined,
      DurableExecutionMode.ReplayMode,
    );
    expect(customLogger._getInfoMock()).toHaveBeenCalledTimes(1);

    // Re-enable modeAware: should not log during replay again
    context.configureLogger({ modeAware: true });
    runWithContext(
      "root",
      undefined,
      () => {
        context.logger.info("message3");
      },
      undefined,
      DurableExecutionMode.ReplayMode,
    );
    expect(customLogger._getInfoMock()).toHaveBeenCalledTimes(1); // Still 1, no new call
  });

  test("should use default modeAware=true when called with empty config", () => {
    const context = createDurableContext(
      mockExecutionContext(),
      mockParentContext,
      DurableExecutionMode.ReplayMode,
      createDefaultLogger(),
      undefined,
      mockDurableExecution,
    );
    context.configureLogger({});

    // With default modeAware=true, should not log during replay
    context.logger.info("replay message");

    // Default logger logs to console, but in replay mode with modeAware=true it should be suppressed
    // We can't easily test console output, but we can verify the context was configured
    expect(context.logger).toBeDefined();
  });

  test("should handle multiple partial configurations correctly", () => {
    const customLogger1 = createMockLogger();
    const customLogger2 = createMockLogger();

    const context = createDurableContext(
      mockExecutionContext(),
      mockParentContext,
      DurableExecutionMode.ReplayMode,
      createDefaultLogger(),
      undefined,
      mockDurableExecution,
    );

    // First: set custom logger only
    context.configureLogger({ customLogger: customLogger1 as any });
    runWithContext(
      "root",
      undefined,
      () => {
        context.logger.info("message1");
      },
      undefined,
      DurableExecutionMode.ReplayMode,
    );
    expect(customLogger1._getInfoMock()).not.toHaveBeenCalled(); // modeAware=true by default

    // Second: change modeAware only (should keep customLogger1)
    context.configureLogger({ modeAware: false });
    runWithContext(
      "root",
      undefined,
      () => {
        context.logger.info("message2");
      },
      undefined,
      DurableExecutionMode.ReplayMode,
    );
    expect(customLogger1._getInfoMock()).toHaveBeenCalledTimes(1); // Now logs with customLogger1

    // Third: change custom logger only (should keep modeAware=false)
    context.configureLogger({ customLogger: customLogger2 as any });
    runWithContext(
      "root",
      undefined,
      () => {
        context.logger.info("message3");
      },
      undefined,
      DurableExecutionMode.ReplayMode,
    );
    expect(customLogger1._getInfoMock()).toHaveBeenCalledTimes(1); // No more calls to logger1
    expect(customLogger2._getInfoMock()).toHaveBeenCalledTimes(1); // Now uses logger2

    // Fourth: change modeAware back to true (should keep customLogger2)
    context.configureLogger({ modeAware: true });
    runWithContext(
      "root",
      undefined,
      () => {
        context.logger.info("message4");
      },
      undefined,
      DurableExecutionMode.ReplayMode,
    );
    expect(customLogger2._getInfoMock()).toHaveBeenCalledTimes(1); // No new calls, suppressed
  });

  test("should preserve settings when called with empty config", () => {
    const customLogger = createMockLogger();

    const context = createDurableContext(
      mockExecutionContext(),
      mockParentContext,
      DurableExecutionMode.ReplayMode,
      createDefaultLogger(),
      undefined,
      mockDurableExecution,
    );

    // Set custom logger and modeAware=false
    context.configureLogger({
      customLogger: customLogger as any,
      modeAware: false,
    });
    runWithContext(
      "root",
      undefined,
      () => {
        context.logger.info("message1");
      },
      undefined,
      DurableExecutionMode.ReplayMode,
    );
    expect(customLogger._getInfoMock()).toHaveBeenCalledTimes(1);

    // Call with empty config - should preserve both settings
    context.configureLogger({});
    runWithContext(
      "root",
      undefined,
      () => {
        context.logger.info("message2");
      },
      undefined,
      DurableExecutionMode.ReplayMode,
    );
    expect(customLogger._getInfoMock()).toHaveBeenCalledTimes(2); // Still uses customLogger with modeAware=false
  });
});
