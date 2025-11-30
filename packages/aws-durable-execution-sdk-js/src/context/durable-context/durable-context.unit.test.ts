import { createDurableContext } from "./durable-context";
import { DurableExecutionMode, Duration } from "../../types";
import { DurablePromise } from "../../types/durable-promise";
import { Context } from "aws-lambda";
import { OperationStatus } from "@aws-sdk/client-lambda";
import { createMockExecutionContext } from "../../testing/mock-context";
import { createDefaultLogger } from "../../utils/logger/default-logger";
import { DurableLogger } from "../../types/durable-logger";
import * as contextTracker from "../../utils/context-tracker/context-tracker";

jest.mock("../../utils/checkpoint/checkpoint-manager");
jest.mock("../../handlers/step-handler/step-handler");
jest.mock("../../handlers/invoke-handler/invoke-handler");
jest.mock(
  "../../handlers/run-in-child-context-handler/run-in-child-context-handler",
);
jest.mock("../../handlers/wait-handler/wait-handler");
jest.mock("../../handlers/callback-handler/callback");
jest.mock("../../handlers/wait-for-callback-handler/wait-for-callback-handler");
jest.mock(
  "../../handlers/wait-for-condition-handler/wait-for-condition-handler",
);
jest.mock("../../handlers/map-handler/map-handler");
jest.mock("../../handlers/parallel-handler/parallel-handler");
jest.mock(
  "../../handlers/concurrent-execution-handler/concurrent-execution-handler",
);
jest.mock("../../utils/context-tracker/context-tracker");

describe("DurableContext", () => {
  let mockContext: Context;
  let mockLogger: DurableLogger;
  const mockDurableExecution = {
    checkpointManager: {
      checkpoint: jest.fn().mockResolvedValue(undefined),
      force: jest.fn().mockResolvedValue(undefined),
      setTerminating: jest.fn(),
      hasPendingAncestorCompletion: jest.fn().mockReturnValue(false),
      markOperationState: jest.fn(),
      markOperationAwaited: jest.fn(),
      waitForStatusChange: jest.fn().mockResolvedValue(undefined),
      waitForRetryTimer: jest.fn().mockResolvedValue(undefined),
      getOperationState: jest.fn(),
      getAllOperations: jest.fn().mockReturnValue([]),
    },
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mock implementations
    const { createStepHandler } = jest.requireMock(
      "../../handlers/step-handler/step-handler",
    );
    const { createInvokeHandler } = jest.requireMock(
      "../../handlers/invoke-handler/invoke-handler",
    );
    const { createRunInChildContextHandler } = jest.requireMock(
      "../../handlers/run-in-child-context-handler/run-in-child-context-handler",
    );
    const { createWaitHandler } = jest.requireMock(
      "../../handlers/wait-handler/wait-handler",
    );
    const { createCallback } = jest.requireMock(
      "../../handlers/callback-handler/callback",
    );
    const { createWaitForCallbackHandler } = jest.requireMock(
      "../../handlers/wait-for-callback-handler/wait-for-callback-handler",
    );
    const { createWaitForConditionHandler } = jest.requireMock(
      "../../handlers/wait-for-condition-handler/wait-for-condition-handler",
    );
    const { createMapHandler } = jest.requireMock(
      "../../handlers/map-handler/map-handler",
    );
    const { createParallelHandler } = jest.requireMock(
      "../../handlers/parallel-handler/parallel-handler",
    );
    const { createConcurrentExecutionHandler } = jest.requireMock(
      "../../handlers/concurrent-execution-handler/concurrent-execution-handler",
    );

    createStepHandler.mockReturnValue(jest.fn().mockResolvedValue(undefined));
    createInvokeHandler.mockReturnValue(jest.fn());
    createRunInChildContextHandler.mockReturnValue(jest.fn());
    createWaitHandler.mockReturnValue(
      () => new DurablePromise(() => Promise.resolve()),
    );
    createCallback.mockReturnValue(jest.fn());
    createWaitForCallbackHandler.mockReturnValue(jest.fn());
    createWaitForConditionHandler.mockReturnValue(
      () => new DurablePromise(() => Promise.resolve({})),
    );
    createMapHandler.mockReturnValue(jest.fn());
    createParallelHandler.mockReturnValue(jest.fn());
    createConcurrentExecutionHandler.mockReturnValue(jest.fn());

    mockContext = {
      awsRequestId: "test-request-id",
      functionName: "test-function",
      getRemainingTimeInMillis: (): number => 30000,
    } as Context;

    mockLogger = createDefaultLogger();
  });

  describe("createDurableContext", () => {
    it("should create context with all required methods", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      expect(context.step).toBeDefined();
      expect(context.invoke).toBeDefined();
      expect(context.runInChildContext).toBeDefined();
      expect(context.wait).toBeDefined();
      expect(context.createCallback).toBeDefined();
      expect(context.waitForCallback).toBeDefined();
      expect(context.waitForCondition).toBeDefined();
      expect(context.map).toBeDefined();
      expect(context.parallel).toBeDefined();
      expect(context.promise).toBeDefined();
      expect(context.logger).toBeDefined();
      expect(context.configureLogger).toBeDefined();
    });

    it("should expose lambdaContext", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      expect(context.lambdaContext).toBe(mockContext);
    });
  });

  describe("withModeManagement", () => {
    it("should execute operation in ExecutionMode", async () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      const { createStepHandler } = jest.requireMock(
        "../../handlers/step-handler/step-handler",
      );
      const mockHandler = jest.fn().mockResolvedValue("result");
      createStepHandler.mockReturnValue(mockHandler);

      await context.step(async (): Promise<string> => "result");

      expect(mockHandler).toHaveBeenCalled();
    });

    it("should switch from ReplayMode to ExecutionMode when next step not found", async () => {
      const executionContext = createMockExecutionContext({
        getStepData: jest.fn().mockReturnValue(undefined),
      });

      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ReplayMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      await context.step(async (): Promise<string> => "result");

      expect(executionContext.getStepData).toHaveBeenCalled();
    });

    it("should switch mode when step is unfinished", async () => {
      const executionContext = createMockExecutionContext({
        getStepData: jest
          .fn()
          .mockReturnValue({ Id: "1", Status: OperationStatus.STARTED }),
      });

      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ReplayMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      await context.step(async (): Promise<string> => "result");

      expect(executionContext.getStepData).toHaveBeenCalled();
    });

    it("should return non-resolving promise in ReplaySucceededContext for unfinished steps", () => {
      const executionContext = createMockExecutionContext({
        getStepData: jest
          .fn()
          .mockReturnValue({ Id: "1", Status: OperationStatus.STARTED }),
      });

      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ReplaySucceededContext,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      const promise = context.step(async (): Promise<string> => "result");
      expect(promise).toBeInstanceOf(DurablePromise);
    });
  });

  describe("step ID generation", () => {
    it("should generate sequential step IDs", async () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      await context.step(async (): Promise<void> => {});
      await context.step(async (): Promise<void> => {});

      const { createStepHandler } = jest.requireMock(
        "../../handlers/step-handler/step-handler",
      );
      const createStepIdFn = createStepHandler.mock.calls[0][3];

      expect(createStepIdFn()).toBe("1");
      expect(createStepIdFn()).toBe("2");
      expect(createStepIdFn()).toBe("3");
    });

    it("should generate prefixed step IDs when prefix provided", async () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        "child",
        mockDurableExecution,
      );

      await context.step(async (): Promise<void> => {});

      const { createStepHandler } = jest.requireMock(
        "../../handlers/step-handler/step-handler",
      );
      const createStepIdFn = createStepHandler.mock.calls[0][3];

      expect(createStepIdFn()).toBe("child-1");
      expect(createStepIdFn()).toBe("child-2");
    });
  });

  describe("operation handlers", () => {
    it("should call step handler", async () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      await context.step(async (): Promise<string> => "result");

      const { createStepHandler } = jest.requireMock(
        "../../handlers/step-handler/step-handler",
      );
      expect(createStepHandler).toHaveBeenCalled();
    });

    it("should call invoke handler", async () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      await context.invoke("func", {});

      const { createInvokeHandler } = jest.requireMock(
        "../../handlers/invoke-handler/invoke-handler",
      );
      expect(createInvokeHandler).toHaveBeenCalled();
    });

    it("should call runInChildContext handler", async () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      await context.runInChildContext(async (): Promise<string> => "result");

      const { createRunInChildContextHandler } = jest.requireMock(
        "../../handlers/run-in-child-context-handler/run-in-child-context-handler",
      );
      expect(createRunInChildContextHandler).toHaveBeenCalled();

      // Call the logger getter to cover line 222
      const getLoggerFn = createRunInChildContextHandler.mock.calls[0][4];
      const logger = getLoggerFn();
      expect(logger).toBeDefined();
    });

    it("should call wait handler", async () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      await context.wait({ seconds: 5 });

      const { createWaitHandler } = jest.requireMock(
        "../../handlers/wait-handler/wait-handler",
      );
      expect(createWaitHandler).toHaveBeenCalled();
    });

    it("should call wait handler with name", async () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      const { createWaitHandler } = jest.requireMock(
        "../../handlers/wait-handler/wait-handler",
      );
      const mockHandler = jest.fn(
        () => new DurablePromise(() => Promise.resolve()),
      );
      createWaitHandler.mockReturnValue(mockHandler);

      await context.wait("wait-name", { seconds: 5 });

      expect(mockHandler).toHaveBeenCalledWith("wait-name", { seconds: 5 });
    });

    it("should call createCallback handler", async () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      await context.createCallback();

      const { createCallback } = jest.requireMock(
        "../../handlers/callback-handler/callback",
      );
      expect(createCallback).toHaveBeenCalled();
    });

    it("should call waitForCallback handler", async () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      await context.waitForCallback(async (): Promise<void> => {});

      const { createWaitForCallbackHandler } = jest.requireMock(
        "../../handlers/wait-for-callback-handler/wait-for-callback-handler",
      );
      expect(createWaitForCallbackHandler).toHaveBeenCalled();
    });

    it("should call waitForCondition handler", async () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      const checkFunc = jest.fn();
      const config = {
        initialState: {},
        waitStrategy: (): {
          shouldContinue: boolean;
          delay: Duration;
        } => ({
          shouldContinue: true,
          delay: { seconds: 1 },
        }),
      };

      await context.waitForCondition(checkFunc, config);

      const { createWaitForConditionHandler } = jest.requireMock(
        "../../handlers/wait-for-condition-handler/wait-for-condition-handler",
      );
      expect(createWaitForConditionHandler).toHaveBeenCalled();
    });

    it("should call waitForCondition handler with name", async () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      const { createWaitForConditionHandler } = jest.requireMock(
        "../../handlers/wait-for-condition-handler/wait-for-condition-handler",
      );
      const mockHandler = jest.fn();
      createWaitForConditionHandler.mockReturnValue(mockHandler);

      const checkFunc = jest.fn();
      const config = {
        initialState: {},
        waitStrategy: (): {
          shouldContinue: boolean;
          delay: Duration;
        } => ({
          shouldContinue: true,
          delay: { seconds: 1 },
        }),
      };

      await context.waitForCondition("condition-name", checkFunc, config);

      expect(mockHandler).toHaveBeenCalledWith(
        "condition-name",
        checkFunc,
        config,
      );
    });

    it("should track running operations via hasRunningOperations", async () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      const { createInvokeHandler } = jest.requireMock(
        "../../handlers/invoke-handler/invoke-handler",
      );

      await context.invoke("func", {});

      // New invoke handler uses centralized termination, no hasRunningOperations parameter
      // Verify it was called with the new signature (context, checkpoint, createStepId, parentId, checkAndUpdateReplayMode)
      expect(createInvokeHandler.mock.calls[0].length).toBe(5);
    });

    it("should call map handler", async () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      await context.map([1, 2], async (): Promise<string> => "result");

      const { createMapHandler } = jest.requireMock(
        "../../handlers/map-handler/map-handler",
      );
      expect(createMapHandler).toHaveBeenCalled();
    });

    it("should call parallel handler", async () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      await context.parallel([async (): Promise<string> => "result"]);

      const { createParallelHandler } = jest.requireMock(
        "../../handlers/parallel-handler/parallel-handler",
      );
      expect(createParallelHandler).toHaveBeenCalled();
    });
  });

  describe("custom logger", () => {
    it("should allow setting custom logger", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      const customLogger = {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        configureDurableLoggingContext: jest.fn(),
      };

      expect(() => context.configureLogger({ customLogger })).not.toThrow();
    });

    it("should reassign this.logger and use new custom logger after configureLogger", () => {
      const originalLogger = {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
      };

      const newCustomLogger = {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        configureDurableLoggingContext: jest.fn(),
      };

      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        originalLogger,
        undefined,
        mockDurableExecution,
      );

      // Mock context to allow logging
      const mockGetActiveContext =
        contextTracker.getActiveContext as jest.MockedFunction<
          typeof contextTracker.getActiveContext
        >;
      mockGetActiveContext.mockReturnValue(undefined);

      // Initially should use original logger
      context.logger.info("original message");
      expect(originalLogger.info).toHaveBeenCalledWith("original message");
      expect(newCustomLogger.info).not.toHaveBeenCalled();

      // Configure with new custom logger
      jest.clearAllMocks();
      context.configureLogger({ customLogger: newCustomLogger });

      // Now should use the new custom logger
      context.logger.info("new message");
      expect(newCustomLogger.info).toHaveBeenCalledWith("new message");
      expect(originalLogger.info).not.toHaveBeenCalled();

      // Verify configureDurableLoggingContext was called
      expect(
        newCustomLogger.configureDurableLoggingContext,
      ).toHaveBeenCalledWith({
        getDurableLogData: expect.any(Function),
      });
    });

    it("should work with custom logger without configureDurableLoggingContext", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      const customLoggerWithoutConfigure = {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        // configureDurableLoggingContext is undefined/missing
      };

      expect(() =>
        context.configureLogger({ customLogger: customLoggerWithoutConfigure }),
      ).not.toThrow();
      expect(context.logger).toStrictEqual({
        log: expect.any(Function),
        info: expect.any(Function),
        warn: expect.any(Function),
        error: expect.any(Function),
        debug: expect.any(Function),
      });

      // Test that logger functions work and call underlying logger when modeAware is enabled (default)
      // Mock getActiveContext to return undefined (should allow logging)
      const mockGetActiveContext =
        contextTracker.getActiveContext as jest.MockedFunction<
          typeof contextTracker.getActiveContext
        >;
      mockGetActiveContext.mockReturnValue(undefined);

      context.logger.info("test message");
      expect(customLoggerWithoutConfigure.info).toHaveBeenCalledWith(
        "test message",
      );
    });

    it("should call configureDurableLoggingContext when available during logger configuration", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      const configureMock = jest.fn();
      const customLogger = {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        configureDurableLoggingContext: configureMock,
      };

      context.configureLogger({ customLogger });

      expect(configureMock).toHaveBeenCalledWith({
        getDurableLogData: expect.any(Function),
      });
    });
  });

  describe("configureDurableLoggingContext handling", () => {
    it("should create context with logger that has configureDurableLoggingContext", () => {
      const configureMock = jest.fn();
      const loggerWithConfigure = {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        configureDurableLoggingContext: configureMock,
      };

      const executionContext = createMockExecutionContext();

      expect(() =>
        createDurableContext(
          executionContext,
          mockContext,
          DurableExecutionMode.ExecutionMode,
          loggerWithConfigure,
          undefined,
          mockDurableExecution,
        ),
      ).not.toThrow();

      expect(configureMock).toHaveBeenCalledWith({
        getDurableLogData: expect.any(Function),
      });
    });

    it("should create context with logger without configureDurableLoggingContext", () => {
      const loggerWithoutConfigure = {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        // configureDurableLoggingContext is undefined/missing
      };

      const executionContext = createMockExecutionContext();

      expect(() =>
        createDurableContext(
          executionContext,
          mockContext,
          DurableExecutionMode.ExecutionMode,
          loggerWithoutConfigure,
          undefined,
          mockDurableExecution,
        ),
      ).not.toThrow();

      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        loggerWithoutConfigure,
        undefined,
        mockDurableExecution,
      );

      expect(context.logger).toStrictEqual({
        log: expect.any(Function),
        info: expect.any(Function),
        warn: expect.any(Function),
        error: expect.any(Function),
        debug: expect.any(Function),
      });

      // Test that all context.logger functions call the underlying logger
      context.logger.info("test info");
      context.logger.warn("test warn");
      context.logger.error("test error");
      context.logger.debug("test debug");
      if (context.logger.log) {
        context.logger.log("INFO", "test log");
      }

      expect(loggerWithoutConfigure.info).toHaveBeenCalledWith("test info");
      expect(loggerWithoutConfigure.warn).toHaveBeenCalledWith("test warn");
      expect(loggerWithoutConfigure.error).toHaveBeenCalledWith("test error");
      expect(loggerWithoutConfigure.debug).toHaveBeenCalledWith("test debug");
      expect(loggerWithoutConfigure.log).toHaveBeenCalledWith(
        "INFO",
        "test log",
      );
    });

    it("should not call configureDurableLoggingContext when configuring logger with modeAware only", () => {
      const configureMock = jest.fn();
      const loggerWithConfigure = {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        configureDurableLoggingContext: configureMock,
      };

      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        loggerWithConfigure,
        undefined,
        mockDurableExecution,
      );

      // Clear any calls from constructor
      configureMock.mockClear();

      // Only configure modeAware, not customLogger
      context.configureLogger({ modeAware: false });

      expect(configureMock).not.toHaveBeenCalled();
    });
  });

  describe("promise utilities", () => {
    it("should provide promise.all", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      expect(context.promise.all).toBeDefined();
      expect(typeof context.promise.all).toBe("function");
    });

    it("should provide promise.allSettled", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      expect(context.promise.allSettled).toBeDefined();
      expect(typeof context.promise.allSettled).toBe("function");
    });

    it("should provide promise.race", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      expect(context.promise.race).toBeDefined();
      expect(typeof context.promise.race).toBe("function");
    });

    it("should provide promise.any", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      expect(context.promise.any).toBeDefined();
      expect(typeof context.promise.any).toBe("function");
    });
  });

  describe("mode-aware logging (shouldLog & createModeAwareLogger)", () => {
    let mockGetActiveContext: jest.MockedFunction<
      typeof contextTracker.getActiveContext
    >;
    let mockLogger: DurableLogger;

    beforeEach(() => {
      mockGetActiveContext =
        contextTracker.getActiveContext as jest.MockedFunction<
          typeof contextTracker.getActiveContext
        >;
      mockGetActiveContext.mockClear();

      mockLogger = {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
      };
    });

    it("should always log when modeAware is disabled", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ReplayMode, // Even in replay mode
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      // Disable mode-aware logging
      context.configureLogger({ modeAware: false });

      // Mock active context in replay mode (normally would suppress logging)
      mockGetActiveContext.mockReturnValue({
        contextId: "step-1",
        durableExecutionMode: DurableExecutionMode.ReplayMode,
        attempt: 1,
      });

      // All logging should work regardless of mode
      context.logger.info("test message");
      context.logger.warn("test warning");
      context.logger.error("test error");
      context.logger.debug("test debug");
      context.logger.log!("INFO", "test log");

      expect(mockLogger.info).toHaveBeenCalledWith("test message");
      expect(mockLogger.warn).toHaveBeenCalledWith("test warning");
      expect(mockLogger.error).toHaveBeenCalledWith("test error");
      expect(mockLogger.debug).toHaveBeenCalledWith("test debug");
      expect(mockLogger.log).toHaveBeenCalledWith("INFO", "test log");
    });

    it.each([
      {
        scenario: "no active context",
        activeContext: undefined,
        contextMode: DurableExecutionMode.ExecutionMode,
        message: "no context",
      },
      {
        scenario: "root context with ExecutionMode",
        activeContext: {
          contextId: "root",
          durableExecutionMode: DurableExecutionMode.ReplayMode,
          attempt: 1,
        },
        contextMode: DurableExecutionMode.ExecutionMode,
        message: "root execution",
      },
      {
        scenario: "child context in ExecutionMode",
        activeContext: {
          contextId: "step-1",
          durableExecutionMode: DurableExecutionMode.ExecutionMode,
          attempt: 1,
        },
        contextMode: DurableExecutionMode.ExecutionMode,
        message: "child execution",
      },
    ])(
      "should log when $scenario",
      ({ activeContext, contextMode, message }) => {
        const executionContext = createMockExecutionContext();
        const context = createDurableContext(
          executionContext,
          mockContext,
          contextMode,
          mockLogger,
          undefined,
          mockDurableExecution,
        );

        mockGetActiveContext.mockReturnValue(activeContext);
        context.logger.info(message);

        expect(mockLogger.info).toHaveBeenCalledWith(message);
      },
    );

    it.each([
      {
        scenario: "root context in ReplayMode",
        activeContext: {
          contextId: "root",
          durableExecutionMode: DurableExecutionMode.ReplayMode,
          attempt: 1,
        },
        contextMode: DurableExecutionMode.ReplayMode,
        message: "root replay",
      },
      {
        scenario: "child context in ReplayMode",
        activeContext: {
          contextId: "step-1",
          durableExecutionMode: DurableExecutionMode.ReplayMode,
          attempt: 1,
        },
        contextMode: DurableExecutionMode.ReplayMode,
        message: "child replay",
      },
    ])(
      "should suppress logging when $scenario",
      ({ activeContext, contextMode, message }) => {
        const executionContext = createMockExecutionContext();
        const context = createDurableContext(
          executionContext,
          mockContext,
          contextMode,
          mockLogger,
          undefined,
          mockDurableExecution,
        );

        mockGetActiveContext.mockReturnValue(activeContext);
        context.logger.info(message);
        expect(mockLogger.info).not.toHaveBeenCalled();
      },
    );

    it("should create mode-aware logger with conditional log method based on underlying logger", () => {
      const mockLoggerWithLog = {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
      };

      const mockLoggerWithoutLog = {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        // no log method
      };

      const executionContext = createMockExecutionContext();

      // Test with log method present
      const contextWithLog = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLoggerWithLog,
        undefined,
        mockDurableExecution,
      );
      expect(contextWithLog.logger.log).toBeDefined();
      expect(typeof contextWithLog.logger.log).toBe("function");

      // Test without log method
      const contextWithoutLog = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        mockLoggerWithoutLog,
        undefined,
        mockDurableExecution,
      );
      expect(contextWithoutLog.logger.log).toBeUndefined();

      // All contexts should have standard methods
      [contextWithLog, contextWithoutLog].forEach((context) => {
        expect(context.logger.info).toBeDefined();
        expect(context.logger.warn).toBeDefined();
        expect(context.logger.error).toBeDefined();
        expect(context.logger.debug).toBeDefined();
      });
    });

    it("should respect mode changes when reconfiguring logger", () => {
      const mockLogger = {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
      };

      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ReplayMode,
        mockLogger,
        undefined,
        mockDurableExecution,
      );

      // Mock context that would normally suppress logging
      mockGetActiveContext.mockReturnValue({
        contextId: "step-1",
        durableExecutionMode: DurableExecutionMode.ReplayMode,
        attempt: 1,
      });

      // Initially, logging should be suppressed
      context.logger.info("suppressed message");
      expect(mockLogger.info).not.toHaveBeenCalled();

      // Disable mode-aware logging
      context.configureLogger({ modeAware: false });

      // Now logging should work
      context.logger.info("allowed message");
      expect(mockLogger.info).toHaveBeenCalledWith("allowed message");

      // Re-enable mode-aware logging
      jest.clearAllMocks();
      context.configureLogger({ modeAware: true });

      // Logging should be suppressed again
      context.logger.info("suppressed again");
      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });
});
