import { createDurableContext } from "./durable-context";
import { DurableExecutionMode, Duration } from "../../types";
import { Context } from "aws-lambda";
import { OperationStatus } from "@aws-sdk/client-lambda";
import { createMockExecutionContext } from "../../testing/mock-context";

jest.mock("../../utils/checkpoint/checkpoint");
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

describe("DurableContext", () => {
  let mockContext: Context;

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

    createStepHandler.mockReturnValue(jest.fn());
    createInvokeHandler.mockReturnValue(jest.fn());
    createRunInChildContextHandler.mockReturnValue(jest.fn());
    createWaitHandler.mockReturnValue(jest.fn());
    createCallback.mockReturnValue(jest.fn());
    createWaitForCallbackHandler.mockReturnValue(jest.fn());
    createWaitForConditionHandler.mockReturnValue(jest.fn());
    createMapHandler.mockReturnValue(jest.fn());
    createParallelHandler.mockReturnValue(jest.fn());
    createConcurrentExecutionHandler.mockReturnValue(jest.fn());

    mockContext = {
      awsRequestId: "test-request-id",
      functionName: "test-function",
      getRemainingTimeInMillis: (): number => 30000,
    } as Context;
  });

  describe("createDurableContext", () => {
    it("should create context with all required methods", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
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
      expect(context.executeConcurrently).toBeDefined();
      expect(context.promise).toBeDefined();
      expect(context.logger).toBeDefined();
      expect(context.setCustomLogger).toBeDefined();
    });

    it("should expose lambdaContext", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
      );

      expect(context.lambdaContext).toBe(mockContext);
    });
  });

  describe("withModeManagement", () => {
    it("should execute operation in ExecutionMode", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
      );

      const { createStepHandler } = jest.requireMock(
        "../../handlers/step-handler/step-handler",
      );
      const mockHandler = jest.fn();
      createStepHandler.mockReturnValue(mockHandler);

      context.step(async (): Promise<string> => "result");

      expect(mockHandler).toHaveBeenCalled();
    });

    it("should switch from ReplayMode to ExecutionMode when next step not found", () => {
      const executionContext = createMockExecutionContext({
        getStepData: jest.fn().mockReturnValue(undefined),
      });

      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ReplayMode,
      );

      context.step(async (): Promise<string> => "result");

      expect(executionContext.getStepData).toHaveBeenCalled();
    });

    it("should switch mode when step is unfinished", () => {
      const executionContext = createMockExecutionContext({
        getStepData: jest
          .fn()
          .mockReturnValue({ Id: "1", Status: OperationStatus.STARTED }),
      });

      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ReplayMode,
      );

      context.step(async (): Promise<string> => "result");

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
      );

      const promise = context.step(async (): Promise<string> => "result");
      expect(promise).toBeInstanceOf(Promise);
    });
  });

  describe("step ID generation", () => {
    it("should generate sequential step IDs", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
      );

      context.step(async (): Promise<void> => {});
      context.step(async (): Promise<void> => {});

      const { createStepHandler } = jest.requireMock(
        "../../handlers/step-handler/step-handler",
      );
      const createStepIdFn = createStepHandler.mock.calls[0][3];

      expect(createStepIdFn()).toBe("1");
      expect(createStepIdFn()).toBe("2");
      expect(createStepIdFn()).toBe("3");
    });

    it("should generate prefixed step IDs when prefix provided", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
        "child",
      );

      context.step(async (): Promise<void> => {});

      const { createStepHandler } = jest.requireMock(
        "../../handlers/step-handler/step-handler",
      );
      const createStepIdFn = createStepHandler.mock.calls[0][3];

      expect(createStepIdFn()).toBe("child-1");
      expect(createStepIdFn()).toBe("child-2");
    });
  });

  describe("operation handlers", () => {
    it("should call step handler", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
      );

      context.step(async (): Promise<string> => "result");

      const { createStepHandler } = jest.requireMock(
        "../../handlers/step-handler/step-handler",
      );
      expect(createStepHandler).toHaveBeenCalled();
    });

    it("should call invoke handler", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
      );

      context.invoke("func", {});

      const { createInvokeHandler } = jest.requireMock(
        "../../handlers/invoke-handler/invoke-handler",
      );
      expect(createInvokeHandler).toHaveBeenCalled();
    });

    it("should call runInChildContext handler", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
      );

      context.runInChildContext(async (): Promise<string> => "result");

      const { createRunInChildContextHandler } = jest.requireMock(
        "../../handlers/run-in-child-context-handler/run-in-child-context-handler",
      );
      expect(createRunInChildContextHandler).toHaveBeenCalled();

      // Call the logger getter to cover line 222
      const getLoggerFn = createRunInChildContextHandler.mock.calls[0][4];
      const logger = getLoggerFn();
      expect(logger).toBeDefined();
    });

    it("should call wait handler", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
      );

      context.wait({ seconds: 5 });

      const { createWaitHandler } = jest.requireMock(
        "../../handlers/wait-handler/wait-handler",
      );
      expect(createWaitHandler).toHaveBeenCalled();
    });

    it("should call wait handler with name", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
      );

      const { createWaitHandler } = jest.requireMock(
        "../../handlers/wait-handler/wait-handler",
      );
      const mockHandler = jest.fn();
      createWaitHandler.mockReturnValue(mockHandler);

      context.wait("wait-name", { seconds: 5 });

      expect(mockHandler).toHaveBeenCalledWith("wait-name", { seconds: 5 });
    });

    it("should call createCallback handler", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
      );

      context.createCallback();

      const { createCallback } = jest.requireMock(
        "../../handlers/callback-handler/callback",
      );
      expect(createCallback).toHaveBeenCalled();
    });

    it("should call waitForCallback handler", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
      );

      context.waitForCallback(async (): Promise<void> => {});

      const { createWaitForCallbackHandler } = jest.requireMock(
        "../../handlers/wait-for-callback-handler/wait-for-callback-handler",
      );
      expect(createWaitForCallbackHandler).toHaveBeenCalled();
    });

    it("should call waitForCondition handler", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
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

      context.waitForCondition(checkFunc, config);

      const { createWaitForConditionHandler } = jest.requireMock(
        "../../handlers/wait-for-condition-handler/wait-for-condition-handler",
      );
      expect(createWaitForConditionHandler).toHaveBeenCalled();
    });

    it("should call waitForCondition handler with name", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
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

      context.waitForCondition("condition-name", checkFunc, config);

      expect(mockHandler).toHaveBeenCalledWith(
        "condition-name",
        checkFunc,
        config,
      );
    });

    it("should track running operations via hasRunningOperations", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
      );

      const { createInvokeHandler } = jest.requireMock(
        "../../handlers/invoke-handler/invoke-handler",
      );

      context.invoke("func", {});
      const hasRunningOperationsFn = createInvokeHandler.mock.calls[0][3];

      expect(hasRunningOperationsFn()).toBe(false);
    });

    it("should call map handler", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
      );

      context.map([1, 2], async (): Promise<string> => "result");

      const { createMapHandler } = jest.requireMock(
        "../../handlers/map-handler/map-handler",
      );
      expect(createMapHandler).toHaveBeenCalled();
    });

    it("should call parallel handler", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
      );

      context.parallel([async (): Promise<string> => "result"]);

      const { createParallelHandler } = jest.requireMock(
        "../../handlers/parallel-handler/parallel-handler",
      );
      expect(createParallelHandler).toHaveBeenCalled();
    });

    it("should call executeConcurrently handler", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
      );

      const items = [{ id: "1", data: "test", index: 0 }];
      context.executeConcurrently(items, async (): Promise<string> => "result");

      const { createConcurrentExecutionHandler } = jest.requireMock(
        "../../handlers/concurrent-execution-handler/concurrent-execution-handler",
      );
      expect(createConcurrentExecutionHandler).toHaveBeenCalled();
    });
  });

  describe("custom logger", () => {
    it("should allow setting custom logger", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
      );

      const customLogger = {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
      };

      expect(() => context.setCustomLogger(customLogger)).not.toThrow();
    });
  });

  describe("promise utilities", () => {
    it("should provide promise.all", () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
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
      );

      expect(context.promise.any).toBeDefined();
      expect(typeof context.promise.any).toBe("function");
    });
  });

  describe("executeConcurrently", () => {
    it("should pass skipNextOperation to concurrent execution handler", async () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
      );

      const { createConcurrentExecutionHandler } = jest.requireMock(
        "../../handlers/concurrent-execution-handler/concurrent-execution-handler",
      );
      const mockHandler = jest.fn().mockResolvedValue({ totalCount: 0 });
      createConcurrentExecutionHandler.mockReturnValue(mockHandler);

      await context.executeConcurrently([], async () => {});

      expect(createConcurrentExecutionHandler).toHaveBeenCalledWith(
        executionContext,
        expect.any(Function),
        expect.any(Function),
      );
    });

    it("should increment step counter when skipNextOperation is called", async () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
      );

      const { createConcurrentExecutionHandler } = jest.requireMock(
        "../../handlers/concurrent-execution-handler/concurrent-execution-handler",
      );

      let capturedSkipNextOperation: (() => void) | null = null;
      const mockHandler = jest.fn().mockResolvedValue({ totalCount: 0 });

      createConcurrentExecutionHandler.mockImplementation(
        (_ctx: any, _runInChild: any, skipNext: any) => {
          capturedSkipNextOperation = skipNext;
          return mockHandler;
        },
      );

      await context.executeConcurrently([], async () => {});

      // Capture the step ID before calling skipNextOperation
      const { createStepHandler } = jest.requireMock(
        "../../handlers/step-handler/step-handler",
      );
      let firstStepId: string | undefined;
      let secondStepId: string | undefined;

      const stepHandler = jest.fn().mockResolvedValue("result");
      createStepHandler.mockImplementation(
        (_ctx: any, _checkpoint: any, _lambdaCtx: any, createStepIdFn: any) => {
          return async (name: any, fn: any, config: any): Promise<any> => {
            const stepId = createStepIdFn();
            if (!firstStepId) {
              firstStepId = stepId;
            } else if (!secondStepId) {
              secondStepId = stepId;
            }
            return stepHandler(name, fn, config);
          };
        },
      );

      // First step should get ID "1"
      await context.step("test1", async () => "value1");

      // Call skipNextOperation to increment counter
      expect(capturedSkipNextOperation).toBeDefined();
      capturedSkipNextOperation!();

      // Next step should get ID "3" (skipped "2")
      await context.step("test2", async () => "value2");

      expect(firstStepId).toBe("1");
      expect(secondStepId).toBe("3");
    });
  });

  describe("operationsEmitter", () => {
    it("should pass operationsEmitter to step handler", async () => {
      const executionContext = createMockExecutionContext();
      const context = createDurableContext(
        executionContext,
        mockContext,
        DurableExecutionMode.ExecutionMode,
      );

      const { createStepHandler } = jest.requireMock(
        "../../handlers/step-handler/step-handler",
      );

      let capturedGetOperationsEmitter: (() => any) | undefined;
      createStepHandler.mockImplementation(
        (
          _ctx: any,
          _checkpoint: any,
          _parentCtx: any,
          _createStepId: any,
          _createLogger: any,
          _addOp: any,
          _removeOp: any,
          _hasOp: any,
          getOperationsEmitter: () => any,
        ): (() => Promise<string>) => {
          capturedGetOperationsEmitter = getOperationsEmitter;
          return async () => "result";
        },
      );

      await context.step("test", async () => "value");

      expect(capturedGetOperationsEmitter).toBeDefined();
      const emitter = capturedGetOperationsEmitter!();
      expect(emitter).toBeDefined();
      expect(typeof emitter.emit).toBe("function");
    });
  });
});
