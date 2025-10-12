import { createModeAwareLogger } from "./mode-aware-logger";
import { ExecutionContext, Logger, DurableExecutionMode } from "../../types";

describe("Mode-Aware Logger", () => {
  let mockExecutionContext: ExecutionContext;
  let mockEnrichedLogger: Logger;
  let mockCreateContextLogger: jest.Mock;

  beforeEach(() => {
    mockEnrichedLogger = {
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    mockCreateContextLogger = jest.fn().mockReturnValue(mockEnrichedLogger);

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
  });

  test("should log in ExecutionMode", () => {
    const logger = createModeAwareLogger(
      DurableExecutionMode.ExecutionMode,
      mockCreateContextLogger,
    );

    logger.info("test message");

    expect(mockEnrichedLogger.info).toHaveBeenCalledWith(
      "test message",
      undefined,
    );
  });

  test("should not log in ReplayMode", () => {
    const logger = createModeAwareLogger(
      DurableExecutionMode.ReplayMode,
      mockCreateContextLogger,
    );

    logger.info("test message");

    expect(mockEnrichedLogger.info).not.toHaveBeenCalled();
  });

  test("should not log in ReplaySucceededContext", () => {
    const logger = createModeAwareLogger(
      DurableExecutionMode.ReplaySucceededContext,
      mockCreateContextLogger,
    );

    logger.info("test message");

    expect(mockEnrichedLogger.info).not.toHaveBeenCalled();
  });

  test("should pass stepPrefix to createContextLogger", () => {
    const stepPrefix = "1-2";
    createModeAwareLogger(
      DurableExecutionMode.ExecutionMode,
      mockCreateContextLogger,
      stepPrefix,
    );

    expect(mockCreateContextLogger).toHaveBeenCalledWith(stepPrefix, undefined);
  });

  test("should pass empty string when no stepPrefix", () => {
    createModeAwareLogger(
      DurableExecutionMode.ExecutionMode,
      mockCreateContextLogger,
    );

    expect(mockCreateContextLogger).toHaveBeenCalledWith("", undefined);
  });

  test("should call all logger methods in ExecutionMode", () => {
    const logger = createModeAwareLogger(
      DurableExecutionMode.ExecutionMode,
      mockCreateContextLogger,
    );

    logger.log("custom", "log message", { data: "test" }, new Error("test"));
    logger.error("error message", new Error("test"), { data: "test" });
    logger.warn("warn message", { data: "test" });
    logger.debug("debug message", { data: "test" });

    expect(mockEnrichedLogger.log).toHaveBeenCalledWith(
      "custom",
      "log message",
      { data: "test" },
      expect.any(Error),
    );
    expect(mockEnrichedLogger.error).toHaveBeenCalledWith(
      "error message",
      expect.any(Error),
      { data: "test" },
    );
    expect(mockEnrichedLogger.warn).toHaveBeenCalledWith("warn message", {
      data: "test",
    });
    expect(mockEnrichedLogger.debug).toHaveBeenCalledWith("debug message", {
      data: "test",
    });
  });

  test("should not call any logger methods in ReplayMode", () => {
    const logger = createModeAwareLogger(
      DurableExecutionMode.ReplayMode,
      mockCreateContextLogger,
    );

    logger.log("custom", "log message");
    logger.error("error message", new Error("test"));
    logger.warn("warn message");
    logger.debug("debug message");

    expect(mockEnrichedLogger.log).not.toHaveBeenCalled();
    expect(mockEnrichedLogger.error).not.toHaveBeenCalled();
    expect(mockEnrichedLogger.warn).not.toHaveBeenCalled();
    expect(mockEnrichedLogger.debug).not.toHaveBeenCalled();
  });
});
