import { createDurableContext, DurableExecution } from "./durable-context";
import { ExecutionContext, DurableExecutionMode } from "../../types";
import { Context } from "aws-lambda";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import { createDefaultLogger } from "../../utils/logger/default-logger";
import { runWithContext } from "../../utils/context-tracker/context-tracker";

describe("DurableContext Logger Property", () => {
  let mockExecutionContext: ExecutionContext;
  let mockParentContext: Context;
  let customLogger: any;
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

    customLogger = {
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      configureDurableLoggingContext: jest.fn(),
    };

    mockExecutionContext = {
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

    mockParentContext = {
      awsRequestId: "test-request-id",
      getRemainingTimeInMillis: () => 30000,
    } as any;
  });

  test("DurableContext should have logger property", () => {
    const context = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ExecutionMode,
      createDefaultLogger(),
      undefined,
      mockDurableExecution,
    );

    expect(context.logger).toBeDefined();
    expect(typeof context.logger.info).toBe("function");
    expect(typeof context.logger.error).toBe("function");
    expect(typeof context.logger.warn).toBe("function");
    expect(typeof context.logger.debug).toBe("function");
  });

  test("DurableContext logger should be customizable via configureLogger", () => {
    const context = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ExecutionMode,
      createDefaultLogger(),
      undefined,
      mockDurableExecution,
    );

    // Set custom logger
    context.configureLogger({ customLogger });

    // Verify it works by calling a method
    context.logger.info("test message", { data: "test" });

    // In the new interface, logger methods take messages directly
    expect(customLogger.info).toHaveBeenCalledWith("test message", {
      data: "test",
    });

    // Verify configureDurableLoggingContext was called to set up the context
    expect(customLogger.configureDurableLoggingContext).toHaveBeenCalledWith({
      getDurableLogData: expect.any(Function),
    });
  });

  test("Logger property should be a live reference (getter)", () => {
    const defaultLogger = createDefaultLogger();

    const infoLogSpy = jest.spyOn(defaultLogger, "info").mockImplementation();

    const context = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ExecutionMode,
      defaultLogger,
      undefined,
      mockDurableExecution,
    );

    // Call logger before setting custom logger
    context.logger.info("message1");

    expect(infoLogSpy).toHaveBeenCalledWith("message1");

    // Set custom logger
    context.configureLogger({ customLogger });

    // Call logger after setting custom logger
    context.logger.info("message2");

    // Custom logger should only be called for the second message
    expect(customLogger.info).toHaveBeenCalledTimes(1);
    expect(customLogger.info).toHaveBeenCalledWith("message2");

    // Verify configureDurableLoggingContext was called to set up the context
    expect(customLogger.configureDurableLoggingContext).toHaveBeenCalledWith({
      getDurableLogData: expect.any(Function),
    });
  });

  test("Logger should only log in ExecutionMode", () => {
    // Helper to create a mock logger that respects shouldLog
    const createMockLogger = (): any => {
      let _loggingContext: any = null;
      const infoMock = jest.fn();

      return {
        log: jest.fn(),
        info: jest.fn((...args: any[]) => {
          infoMock(...args);
        }),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        configureDurableLoggingContext: jest.fn((ctx: any): void => {
          _loggingContext = ctx;
        }),
        _getInfoMock: (): any => infoMock,
      };
    };

    const executionModeLogger = createMockLogger();
    const replayModeLogger = createMockLogger();
    const replaySucceededLogger = createMockLogger();

    // Test in ExecutionMode
    const contextExecution = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ExecutionMode,
      createDefaultLogger(),
      undefined,
      mockDurableExecution,
    );
    contextExecution.configureLogger({
      customLogger: executionModeLogger as any,
    });

    // Simulate being inside an operation with ExecutionMode
    runWithContext(
      "root",
      undefined,
      () => {
        contextExecution.logger.info("execution mode message");
      },
      undefined,
      DurableExecutionMode.ExecutionMode,
    );
    expect(executionModeLogger._getInfoMock()).toHaveBeenCalledWith(
      "execution mode message",
    );

    // Test in ReplayMode - should NOT log when modeAware is true (default)
    const contextReplay = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ReplayMode,
      createDefaultLogger(),
      undefined,
      mockDurableExecution,
    );
    contextReplay.configureLogger({ customLogger: replayModeLogger as any });

    // Simulate being inside an operation with ReplayMode
    runWithContext(
      "root",
      undefined,
      () => {
        contextReplay.logger.info("replay mode message");
      },
      undefined,
      DurableExecutionMode.ReplayMode,
    );
    expect(replayModeLogger._getInfoMock()).not.toHaveBeenCalled();

    // Test in ReplaySucceededContext - should NOT log when modeAware is true (default)
    const contextReplaySucceeded = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ReplaySucceededContext,
      createDefaultLogger(),
      undefined,
      mockDurableExecution,
    );
    contextReplaySucceeded.configureLogger({
      customLogger: replaySucceededLogger as any,
    });

    // Simulate being inside an operation with ReplaySucceededContext
    runWithContext(
      "root",
      undefined,
      () => {
        contextReplaySucceeded.logger.info("replay succeeded message");
      },
      undefined,
      DurableExecutionMode.ReplaySucceededContext,
    );
    expect(replaySucceededLogger._getInfoMock()).not.toHaveBeenCalled();
  });

  test("configureDurableLoggingContext should be called when configureLogger is called", () => {
    const logger1: any = {
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      configureDurableLoggingContext: jest.fn(),
    };

    const logger2: any = {
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      configureDurableLoggingContext: jest.fn(),
    };

    const context = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ExecutionMode,
      createDefaultLogger(),
      undefined,
      mockDurableExecution,
    );

    // First call to configureLogger with logger1
    context.configureLogger({ customLogger: logger1 });

    // Verify configureDurableLoggingContext was called on logger1
    expect(logger1.configureDurableLoggingContext).toHaveBeenCalledTimes(1);
    expect(logger1.configureDurableLoggingContext).toHaveBeenCalledWith({
      getDurableLogData: expect.any(Function),
    });

    // Capture the context passed to logger1
    const logger1Context = (logger1.configureDurableLoggingContext as jest.Mock)
      .mock.calls[0][0];

    // Second call to configureLogger with logger2
    context.configureLogger({ customLogger: logger2 });

    // Verify configureDurableLoggingContext was called on logger2
    expect(logger2.configureDurableLoggingContext).toHaveBeenCalledTimes(1);
    expect(logger2.configureDurableLoggingContext).toHaveBeenCalledWith({
      getDurableLogData: expect.any(Function),
    });

    // Verify logger1 was not called again
    expect(logger1.configureDurableLoggingContext).toHaveBeenCalledTimes(1);

    // Capture the context passed to logger2
    const logger2Context = (logger2.configureDurableLoggingContext as jest.Mock)
      .mock.calls[0][0];

    // Verify both contexts have the same structure but are different instances
    expect(logger1Context).toHaveProperty("getDurableLogData");
    expect(logger2Context).toHaveProperty("getDurableLogData");

    // Test that the logging context functions work correctly
    runWithContext(
      "root",
      undefined,
      () => {
        const logData1 = logger1Context.getDurableLogData();
        const logData2 = logger2Context.getDurableLogData();

        // Both should return the same data since they're from the same context
        expect(logData1).toEqual(logData2);
        expect(logData1).toEqual(
          expect.objectContaining({
            executionArn: "test-arn",
            requestId: mockExecutionContext.requestId,
          }),
        );
      },
      undefined,
      DurableExecutionMode.ExecutionMode,
    );
  });

  test("configureDurableLoggingContext should not be called when only modeAware changes", () => {
    const context = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ExecutionMode,
      createDefaultLogger(),
      undefined,
      mockDurableExecution,
    );

    // Set custom logger
    context.configureLogger({ customLogger });
    expect(customLogger.configureDurableLoggingContext).toHaveBeenCalledTimes(
      1,
    );

    // Change only modeAware - should NOT call configureDurableLoggingContext again
    context.configureLogger({ modeAware: false });
    expect(customLogger.configureDurableLoggingContext).toHaveBeenCalledTimes(
      1,
    );

    // Change modeAware again - still should NOT call configureDurableLoggingContext
    context.configureLogger({ modeAware: true });
    expect(customLogger.configureDurableLoggingContext).toHaveBeenCalledTimes(
      1,
    );
  });

  test("Logger in child context should have operation ID", () => {
    // Use a fresh mock logger for this test
    const childLogger: any = {
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      configureDurableLoggingContext: jest.fn(),
    };

    // Create a child context with a step prefix
    const childContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ExecutionMode,
      createDefaultLogger(),
      undefined,
      mockDurableExecution,
      "1", // stepPrefix for child context
    );
    childContext.configureLogger({ customLogger: childLogger });

    // The operationId should be configured through configureDurableLoggingContext
    expect(childLogger.configureDurableLoggingContext).toHaveBeenCalledWith({
      getDurableLogData: expect.any(Function),
    });

    // Verify the getDurableLogData function returns the correct operationId
    // when called within a child context
    const contextArg = (childLogger.configureDurableLoggingContext as jest.Mock)
      .mock.calls[0][0];

    // Simulate being inside a child context operation
    runWithContext(
      "1", // contextId matching the stepPrefix
      undefined,
      () => {
        const durableLogData = contextArg.getDurableLogData();
        expect(durableLogData).toEqual(
          expect.objectContaining({
            operationId: hashId("1"),
            executionArn: "test-arn",
          }),
        );

        // Also verify the logger actually logs the message
        childContext.logger.info("child message");
        expect(childLogger.info).toHaveBeenCalledWith("child message");
      },
      undefined,
      DurableExecutionMode.ExecutionMode,
    );
  });
});
