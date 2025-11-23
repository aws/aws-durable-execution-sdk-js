import { createDurableContext } from "./durable-context";
import {
  ExecutionContext,
  EnrichedDurableLogger,
  DurableExecutionMode,
} from "../../types";
import { Context } from "aws-lambda";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

describe("DurableContext Logger Property", () => {
  let mockExecutionContext: ExecutionContext;
  let mockParentContext: Context;
  let customLogger: EnrichedDurableLogger;

  beforeEach(() => {
    customLogger = {
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
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
    );

    // Set custom logger
    context.configureLogger({ customLogger });

    // Verify it works by calling a method
    context.logger.info("test message", { data: "test" });

    // Logger is enriched with execution context (no step_id at top level)
    expect(customLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        timestamp: expect.any(String),
        executionArn: "test-arn",
        level: "INFO",
      }),
      "test message",
      { data: "test" },
    );

    // Verify step_id is NOT present
    const callArgs = (customLogger.info as jest.Mock).mock.calls[0][1];
    expect(callArgs).not.toHaveProperty("step_id");
  });

  test("Logger property should be a live reference (getter)", () => {
    const context = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ExecutionMode,
    );

    // Call logger before setting custom logger
    context.logger.info("message1");

    // Set custom logger
    context.configureLogger({ customLogger });

    // Call logger after setting custom logger
    context.logger.info("message2");

    // Custom logger should only be called for the second message
    expect(customLogger.info).toHaveBeenCalledTimes(1);
    expect(customLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        timestamp: expect.any(String),
        executionArn: "test-arn",
        level: "INFO",
      }),
      "message2",
    );

    // Verify step_id is NOT present
    const callArgs = (customLogger.info as jest.Mock).mock.calls[0][1];
    expect(callArgs).not.toHaveProperty("step_id");
  });

  test("Logger should only log in ExecutionMode", () => {
    // Test in ExecutionMode
    const contextExecution = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ExecutionMode,
    );
    contextExecution.configureLogger({ customLogger });

    contextExecution.logger.info("execution mode message");
    expect(customLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        timestamp: expect.any(String),
        executionArn: "test-arn",
        level: "INFO",
      }),
      "execution mode message",
    );

    // Verify step_id is NOT present
    const callArgs = (customLogger.info as jest.Mock).mock.calls[0][1];
    expect(callArgs).not.toHaveProperty("step_id");

    // Reset mock
    jest.clearAllMocks();

    // Test in ReplayMode - should NOT log when modeAware is true (default)
    const contextReplay = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ReplayMode,
    );
    contextReplay.configureLogger({ customLogger });

    contextReplay.logger.info("replay mode message");
    expect(customLogger.info).not.toHaveBeenCalled();

    // Reset mock
    jest.clearAllMocks();

    // Test in ReplaySucceededContext - should NOT log when modeAware is true (default)
    const contextReplaySucceeded = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ReplaySucceededContext,
    );
    contextReplaySucceeded.configureLogger({ customLogger });

    contextReplaySucceeded.logger.info("replay succeeded message");
    expect(customLogger.info).not.toHaveBeenCalled();
  });

  test("Logger in child context should have operation ID", () => {
    // Create a child context with a step prefix
    const childContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ExecutionMode,
      "1", // stepPrefix for child context
    );
    childContext.configureLogger({ customLogger });

    childContext.logger.info("child message");

    // Child context logger should have step_id populated with the hashed prefix
    expect(customLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        timestamp: expect.any(String),
        operationId: hashId("1"),
        executionArn: "test-arn",
        level: "INFO",
      }),
      "child message",
    );
  });
});
