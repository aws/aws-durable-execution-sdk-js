import { createDurableContext } from "./durable-context";
import { ExecutionContext, Logger, DurableExecutionMode } from "../../types";
import { Context } from "aws-lambda";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

describe("DurableContext Logger Property", () => {
  let mockExecutionContext: ExecutionContext;
  let mockParentContext: Context;
  let customLogger: Logger;

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

  test("DurableContext logger should be customizable via setCustomLogger", () => {
    const context = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ExecutionMode,
    );

    // Set custom logger
    context.setCustomLogger(customLogger);

    // Verify it works by calling a method
    context.logger.info("test message", { data: "test" });

    // Logger is enriched with execution context (no step_id at top level)
    expect(customLogger.info).toHaveBeenCalledWith(
      "test message",
      expect.objectContaining({
        execution_arn: "test-arn",
        level: "info",
        message: "test message",
        data: { data: "test" },
      }),
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
    context.setCustomLogger(customLogger);

    // Call logger after setting custom logger
    context.logger.info("message2");

    // Custom logger should only be called for the second message
    expect(customLogger.info).toHaveBeenCalledTimes(1);
    expect(customLogger.info).toHaveBeenCalledWith(
      "message2",
      expect.objectContaining({
        execution_arn: "test-arn",
      }),
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
    contextExecution.setCustomLogger(customLogger);

    contextExecution.logger.info("execution mode message");
    expect(customLogger.info).toHaveBeenCalledWith(
      "execution mode message",
      expect.objectContaining({
        execution_arn: "test-arn",
      }),
    );

    // Verify step_id is NOT present
    const callArgs = (customLogger.info as jest.Mock).mock.calls[0][1];
    expect(callArgs).not.toHaveProperty("step_id");

    // Reset mock
    jest.clearAllMocks();

    // Test in ReplayMode - should NOT log
    const contextReplay = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ReplayMode,
    );
    contextReplay.setCustomLogger(customLogger);

    contextReplay.logger.info("replay mode message");
    expect(customLogger.info).not.toHaveBeenCalled();

    // Reset mock
    jest.clearAllMocks();

    // Test in ReplaySucceededContext - should NOT log
    const contextReplaySucceeded = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ReplaySucceededContext,
    );
    contextReplaySucceeded.setCustomLogger(customLogger);

    contextReplaySucceeded.logger.info("replay succeeded message");
    expect(customLogger.info).not.toHaveBeenCalled();
  });

  test("Logger in child context should have step ID", () => {
    // Create a child context with a step prefix
    const childContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      DurableExecutionMode.ExecutionMode,
      "1", // stepPrefix for child context
    );
    childContext.setCustomLogger(customLogger);

    childContext.logger.info("child message");

    // Child context logger should have step_id populated with the hashed prefix
    expect(customLogger.info).toHaveBeenCalledWith(
      "child message",
      expect.objectContaining({
        execution_arn: "test-arn",
        step_id: hashId("1"),
      }),
    );
  });
});
