import { createDurableContext } from "./durable-context";
import { createStepHandler } from "../../handlers/step-handler/step-handler";
import { createInvokeHandler } from "../../handlers/invoke-handler/invoke-handler";
import { createRunInChildContextHandler } from "../../handlers/run-in-child-context-handler/run-in-child-context-handler";
import { createWaitHandler } from "../../handlers/wait-handler/wait-handler";
import { createCheckpoint } from "../../utils/checkpoint/checkpoint";
import { createCallback } from "../../handlers/callback-handler/callback";
import { createWaitForCallbackHandler } from "../../handlers/wait-for-callback-handler/wait-for-callback-handler";
import { createMapHandler } from "../../handlers/map-handler/map-handler";
import { createParallelHandler } from "../../handlers/parallel-handler/parallel-handler";
import { createConcurrentExecutionHandler } from "../../handlers/concurrent-execution-handler/concurrent-execution-handler";
import { ExecutionContext } from "../../types";
import { Context } from "aws-lambda";
import { createMockExecutionContext } from "../../testing/mock-context";

// Mock the handlers
jest.mock("../../utils/checkpoint/checkpoint");
jest.mock("../../handlers/step-handler/step-handler");
jest.mock("../../handlers/invoke-handler/invoke-handler");
jest.mock(
  "../../handlers/run-in-child-context-handler/run-in-child-context-handler",
);
jest.mock("../../handlers/wait-handler/wait-handler");
jest.mock("../../handlers/callback-handler/callback");
jest.mock("../../handlers/wait-for-callback-handler/wait-for-callback-handler");
jest.mock("../../handlers/map-handler/map-handler");
jest.mock("../../handlers/parallel-handler/parallel-handler");
jest.mock(
  "../../handlers/concurrent-execution-handler/concurrent-execution-handler",
);

describe("Durable Context", () => {
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let mockParentContext: Context;
  let mockCheckpointHandler: jest.Mock;
  let mockStepHandler: jest.Mock;
  let mockInvokeHandler: jest.Mock;
  let mockRunInChildContextHandler: jest.Mock;
  let mockWaitHandler: jest.Mock;
  let mockCallbackHandler: jest.Mock;
  let mockWaitForCallbackHandler: jest.Mock;
  let mockMapHandler: jest.Mock;
  let mockParallelHandler: jest.Mock;
  let mockConcurrentExecutionHandler: jest.Mock;

  beforeEach(() => {
    // Reset all mocks before each test to ensure isolation
    jest.resetAllMocks();

    mockExecutionContext = createMockExecutionContext({
      mutex: {
        lock: jest.fn(),
      },
    });

    mockParentContext = {
      awsRequestId: "mock-request-id",
      callbackWaitsForEmptyEventLoop: true,
      functionName: "mock-function",
      functionVersion: "1",
      invokedFunctionArn:
        "arn:aws:lambda:us-east-1:123456789012:function:mock-function",
      memoryLimitInMB: "128",
      logGroupName: "/aws/lambda/mock-function",
      logStreamName: "2023/01/01/[$LATEST]abcdef123456",
      getRemainingTimeInMillis: (): number => 30000,
      done: (): void => {},
      fail: (): void => {},
      succeed: (): void => {},
    };

    // Setup mocks
    mockCheckpointHandler = jest.fn();
    mockStepHandler = jest.fn();
    mockInvokeHandler = jest.fn();
    mockRunInChildContextHandler = jest.fn();
    mockWaitHandler = jest.fn();
    mockCallbackHandler = jest.fn();
    mockWaitForCallbackHandler = jest.fn();
    mockMapHandler = jest.fn();
    mockParallelHandler = jest.fn();
    mockConcurrentExecutionHandler = jest.fn();

    (createCheckpoint as jest.Mock).mockReturnValue(mockCheckpointHandler);
    (createStepHandler as jest.Mock).mockReturnValue(mockStepHandler);
    (createInvokeHandler as jest.Mock).mockReturnValue(mockInvokeHandler);
    (createRunInChildContextHandler as jest.Mock).mockReturnValue(
      mockRunInChildContextHandler,
    );
    (createWaitHandler as jest.Mock).mockReturnValue(mockWaitHandler);
    (createCallback as jest.Mock).mockReturnValue(mockCallbackHandler);
    (createWaitForCallbackHandler as jest.Mock).mockReturnValue(
      mockWaitForCallbackHandler,
    );
    (createMapHandler as jest.Mock).mockReturnValue(mockMapHandler);
    (createParallelHandler as jest.Mock).mockReturnValue(mockParallelHandler);
    (createConcurrentExecutionHandler as jest.Mock).mockReturnValue(
      mockConcurrentExecutionHandler,
    );
  });

  test("should create a durable context with step, invoke, runInChildContext, wait, createCallback, waitForCallback, map, parallel, and executeConcurrently methods", () => {
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );

    expect(durableContext).toHaveProperty("step");
    expect(durableContext).toHaveProperty("invoke");
    expect(durableContext).toHaveProperty("runInChildContext");
    expect(durableContext).toHaveProperty("wait");
    expect(durableContext).toHaveProperty("createCallback");
    expect(durableContext).toHaveProperty("waitForCallback");
    expect(durableContext).toHaveProperty("map");
    expect(durableContext).toHaveProperty("parallel");
    expect(durableContext).toHaveProperty("executeConcurrently");
    expect(durableContext._stepCounter).toBe(0);
    expect(durableContext._stepPrefix).toBeUndefined();
  });

  test("should create a durable context with step prefix", () => {
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      "test-prefix",
    );

    expect(durableContext._stepPrefix).toBe("test-prefix");
  });

  test("should call step handler when step method is invoked", () => {
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );
    const stepFn = jest.fn();
    const options = { retryStrategy: jest.fn() };

    durableContext.step("test-step", stepFn, options);

    expect(createStepHandler).toHaveBeenCalledWith(
      mockExecutionContext,
      mockCheckpointHandler,
      mockParentContext,
      expect.any(Function), // createStepId
      expect.any(Function), // createContextLogger
      expect.any(Function), // addRunningOperation
      expect.any(Function), // removeRunningOperation
      expect.any(Function), // hasRunningOperations
    );
    expect(mockStepHandler).toHaveBeenCalledWith("test-step", stepFn, options);
  });

  test("should call invoke handler when invoke method is invoked", () => {
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );
    const funcId = "arn:aws:lambda:us-east-1:123456789012:function:test";
    const input = { test: "data" };
    const config = {
      serdes: { serialize: async () => "test", deserialize: async () => ({}) },
    };

    durableContext.invoke("test-invoke", funcId, input, config);

    expect(createInvokeHandler).toHaveBeenCalledWith(
      mockExecutionContext,
      mockCheckpointHandler,
      expect.any(Function), // createStepId
      expect.any(Function), // hasRunningOperations
    );
    expect(mockInvokeHandler).toHaveBeenCalledWith(
      "test-invoke",
      funcId,
      input,
      config,
    );
  });

  test("should call block handler when runInChildContext method is invoked", () => {
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );
    const childFn = jest.fn();

    durableContext.runInChildContext("test-block", childFn);

    expect(createRunInChildContextHandler).toHaveBeenCalledWith(
      mockExecutionContext,
      mockCheckpointHandler,
      mockParentContext,
      expect.any(Function),
    );
    expect(mockRunInChildContextHandler).toHaveBeenCalledWith(
      "test-block",
      childFn,
      undefined,
    );
  });

  test("should call wait handler when wait method is invoked", () => {
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );

    durableContext.wait("test-wait", 1000);

    expect(createWaitHandler).toHaveBeenCalledWith(
      mockExecutionContext,
      mockCheckpointHandler,
      expect.any(Function),
      expect.any(Function), // hasRunningOperations
    );
    expect(mockWaitHandler).toHaveBeenCalledWith("test-wait", 1000);
  });

  test("should provide hasRunningOperations function that returns false when no operations", () => {
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );

    // Call wait to trigger the creation of wait handler with hasRunningOperations
    durableContext.wait(1000);

    // Extract hasRunningOperations function from the createWaitHandler call
    const createWaitHandlerCall = jest.mocked(createWaitHandler).mock.calls[0];
    const hasRunningOperations = createWaitHandlerCall[3]; // 4th parameter

    // Call hasRunningOperations when no operations are running
    const result = hasRunningOperations();
    expect(result).toBe(false);
  });

  test("should call callback handler when createCallback method is invoked", () => {
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );
    const callbackName = "test-callback";
    const callbackConfig = { timeout: 300 };

    durableContext.createCallback(callbackName, callbackConfig);

    expect(createCallback).toHaveBeenCalledWith(
      mockExecutionContext,
      mockCheckpointHandler,
      expect.any(Function),
    );
    expect(mockCallbackHandler).toHaveBeenCalledWith(
      callbackName,
      callbackConfig,
    );
  });

  test("should call callback handler with config as first parameter", () => {
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );
    const callbackConfig = { timeout: 300, heartbeatTimeout: 60 };

    durableContext.createCallback(callbackConfig);

    expect(createCallback).toHaveBeenCalledWith(
      mockExecutionContext,
      mockCheckpointHandler,
      expect.any(Function),
    );
    expect(mockCallbackHandler).toHaveBeenCalledWith(callbackConfig, undefined);
  });

  test("should call waitForCallback handler when waitForCallback method is invoked", () => {
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );
    const submitter = jest.fn();
    const config = { timeout: 300 };

    durableContext.waitForCallback("test-callback", submitter, config);

    expect(createWaitForCallbackHandler).toHaveBeenCalledWith(
      mockExecutionContext,
      expect.any(Function), // This should be the runInChildContext function
    );
    expect(mockWaitForCallbackHandler).toHaveBeenCalledWith(
      "test-callback",
      submitter,
      config,
    );
  });

  test("should generate sequential step IDs", () => {
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );

    // Need to call step to trigger the creation of the step handler
    durableContext.step("test-step", jest.fn());

    // Extract the createStepId function that was passed to createStepHandler
    const createStepIdFn = (createStepHandler as jest.Mock).mock.calls[0][3];

    expect(createStepIdFn()).toBe("1");
    expect(createStepIdFn()).toBe("2");
    expect(createStepIdFn()).toBe("3");
  });

  test("should generate prefixed step IDs when prefix is provided", () => {
    // Reset mocks before this test
    jest.clearAllMocks();

    // Create a new durable context with a prefix
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
      "prefix",
    );

    // Call step once to trigger the creation of the step handler
    durableContext.step("test-step", jest.fn());

    // Extract the createStepId function that was passed to createStepHandler
    const createStepIdFn = (createStepHandler as jest.Mock).mock.calls[0][3];

    // Test that it generates the correct prefixed IDs
    expect(createStepIdFn()).toBe("prefix-1");
    expect(createStepIdFn()).toBe("prefix-2");
    expect(createStepIdFn()).toBe("prefix-3");
  });

  test("should call map handler when map method is invoked", () => {
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );
    const items = [1, 2, 3];
    const mapFunc = jest.fn();
    const config = {};

    durableContext.map("test-map", items, mapFunc, config);

    expect(createMapHandler).toHaveBeenCalledWith(
      mockExecutionContext,
      expect.any(Function), // This should be the runInChildContext function
    );
    expect(mockMapHandler).toHaveBeenCalledWith(
      "test-map",
      items,
      mapFunc,
      config,
    );
  });

  test("should call parallel handler when parallel method is invoked", () => {
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );
    const branches = [jest.fn(), jest.fn()];
    const config = {};

    durableContext.parallel("test-parallel", branches, config);

    expect(createParallelHandler).toHaveBeenCalledWith(
      mockExecutionContext,
      expect.any(Function), // This should be the runInChildContext function
    );
    expect(mockParallelHandler).toHaveBeenCalledWith(
      "test-parallel",
      branches,
      config,
    );
  });

  test("should call executeConcurrently with name, items, executor, and config", () => {
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );
    const items = [
      { id: "item-0", data: "test1", index: 0 },
      { id: "item-1", data: "test2", index: 1 },
    ];
    const executor = jest.fn();
    const config = { maxConcurrency: 2 };

    durableContext.executeConcurrently(
      "test-concurrent",
      items,
      executor,
      config,
    );

    expect(createConcurrentExecutionHandler).toHaveBeenCalledWith(
      mockExecutionContext,
      expect.any(Function), // This should be the runInChildContext function
    );
    expect(mockConcurrentExecutionHandler).toHaveBeenCalledWith(
      "test-concurrent",
      items,
      executor,
      config,
    );
  });

  test("should call executeConcurrently without name (items, executor, config)", () => {
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );
    const items = [
      { id: "item-0", data: "test1", index: 0 },
      { id: "item-1", data: "test2", index: 1 },
    ];
    const executor = jest.fn();
    const config = { maxConcurrency: 3 };

    durableContext.executeConcurrently(items, executor, config);

    expect(createConcurrentExecutionHandler).toHaveBeenCalledWith(
      mockExecutionContext,
      expect.any(Function), // This should be the runInChildContext function
    );
    expect(mockConcurrentExecutionHandler).toHaveBeenCalledWith(
      items,
      executor,
      config,
      undefined, // maybeConfig parameter
    );
  });

  test("should call executeConcurrently without config (items, executor)", () => {
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );
    const items = [{ id: "item-0", data: "test1", index: 0 }];
    const executor = jest.fn();

    durableContext.executeConcurrently(items, executor);

    expect(createConcurrentExecutionHandler).toHaveBeenCalledWith(
      mockExecutionContext,
      expect.any(Function), // This should be the runInChildContext function
    );
    expect(mockConcurrentExecutionHandler).toHaveBeenCalledWith(
      items,
      executor,
      undefined, // executorOrConfig parameter
      undefined, // maybeConfig parameter
    );
  });

  test("should call executeConcurrently with name but without config (name, items, executor)", () => {
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );
    const items = [{ id: "item-0", data: "test1", index: 0 }];
    const executor = jest.fn();

    durableContext.executeConcurrently("named-execution", items, executor);

    expect(createConcurrentExecutionHandler).toHaveBeenCalledWith(
      mockExecutionContext,
      expect.any(Function), // This should be the runInChildContext function
    );
    expect(mockConcurrentExecutionHandler).toHaveBeenCalledWith(
      "named-execution",
      items,
      executor,
      undefined, // maybeConfig parameter
    );
  });

  it("should have configureLogger method available", () => {
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );
    expect(typeof durableContext.setCustomLogger).toBe("function");
  });

  it("should configure custom logger through DurableContext", () => {
    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );

    const mockCustomLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    };

    // Configure custom logger
    durableContext.setCustomLogger(mockCustomLogger);

    // Verify that the custom logger was set by checking the setCustomLogger was called
    // Since the step handler is mocked, we can't test the full integration here
    // but we can verify the method exists and doesn't throw
    expect(() =>
      durableContext.setCustomLogger(mockCustomLogger),
    ).not.toThrow();
  });

  it("should use default logger when no custom logger is set", () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();

    // Temporarily restore the real step handler to test actual logger usage
    const originalCreateStepHandler = jest.requireActual(
      "../../handlers/step-handler/step-handler",
    ).createStepHandler;
    (createStepHandler as jest.Mock).mockImplementationOnce(
      originalCreateStepHandler,
    );

    const durableContext = createDurableContext(
      mockExecutionContext,
      mockParentContext,
    );

    // This will use the real step handler which will call the context logger
    const stepFn = jest.fn().mockImplementation(async (ctx) => {
      // Use all logger methods to ensure full coverage of createDefaultLogger
      ctx.logger.log("custom", "test message");
      ctx.logger.info("info test");
      ctx.logger.error("error test", new Error("test"));
      ctx.logger.warn("warn test");
      ctx.logger.debug("debug test");
      return "result";
    });

    // This should trigger the default logger
    durableContext.step("test-step", stepFn);

    // Verify console.log was called
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
