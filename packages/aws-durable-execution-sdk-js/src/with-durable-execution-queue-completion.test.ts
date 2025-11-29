import { withDurableExecution } from "./with-durable-execution";
import { initializeExecutionContext } from "./context/execution-context/execution-context";
import { createDurableContext } from "./context/durable-context/durable-context";
import { Context } from "aws-lambda";
import { DurableExecutionInvocationInput } from "./types";
import { log } from "./utils/logger/logger";
import { CheckpointManager } from "./utils/checkpoint/checkpoint-manager";

// Mock dependencies
jest.mock("./context/execution-context/execution-context");
jest.mock("./context/durable-context/durable-context");
jest.mock("./utils/logger/logger", () => ({
  log: jest.fn(),
}));

describe("withDurableExecution Queue Completion", () => {
  const mockEvent: DurableExecutionInvocationInput = {
    CheckpointToken: "test-token",
    DurableExecutionArn: "test-arn",
    InitialExecutionState: {
      Operations: [],
      NextMarker: "",
    },
  };

  const mockContext = {} as Context;
  let mockTerminationManager: any;
  let mockExecutionContext: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockTerminationManager = {
      getTerminationPromise: jest.fn().mockReturnValue(new Promise(() => {})),
      terminate: jest.fn(),
      setCheckpointTerminatingCallback: jest.fn(),
    };

    mockExecutionContext = {
      state: {},
      _stepData: {},
      terminationManager: mockTerminationManager,
      durableExecutionArn: "test-arn",
      activeOperationsTracker: undefined,
      pendingCompletions: new Set(),
    };

    (initializeExecutionContext as jest.Mock).mockResolvedValue({
      executionContext: mockExecutionContext,
      durableExecutionMode: "NORMAL",
      checkpointToken: "test-token",
    });

    (createDurableContext as jest.Mock).mockImplementation(
      (ctx, lambdaCtx, mode, logger, opts, durableExecution) => {
        return {};
      },
    );
  });

  it("should not call waitForQueueCompletion on successful handler execution", async () => {
    const clearSpy = jest.spyOn(CheckpointManager.prototype, "clearQueue");

    const mockHandler = jest.fn().mockResolvedValue("success");
    const wrappedHandler = withDurableExecution(mockHandler);

    await wrappedHandler(mockEvent, mockContext);

    expect(clearSpy).not.toHaveBeenCalled();

    clearSpy.mockRestore();
  });

  it("should not call waitForQueueCompletion even on termination", async () => {
    // Mock handler to take longer so termination wins the race
    const mockHandler = jest
      .fn()
      .mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve("success"), 1000)),
      );

    // Mock termination promise to resolve immediately
    mockTerminationManager.getTerminationPromise.mockResolvedValue({
      reason: "TIMEOUT",
    });

    const wrappedHandler = withDurableExecution(mockHandler);

    await wrappedHandler(mockEvent, mockContext);
  });

  it("should complete quickly without waitForQueueCompletion", async () => {
    const mockHandler = jest.fn().mockResolvedValue("success");
    const wrappedHandler = withDurableExecution(mockHandler);

    const startTime = Date.now();
    await wrappedHandler(mockEvent, mockContext);
    const endTime = Date.now();

    // Should complete quickly since waitForQueueCompletion is not called
    expect(endTime - startTime).toBeLessThan(1000);
  }, 10000);

  it("should not call waitForQueueCompletion and not log errors", async () => {
    const mockHandler = jest.fn().mockResolvedValue("success");
    const wrappedHandler = withDurableExecution(mockHandler);

    // Should complete successfully without calling waitForQueueCompletion
    await expect(wrappedHandler(mockEvent, mockContext)).resolves.toBeDefined();
    expect(log).not.toHaveBeenCalledWith(
      "⚠️",
      "Error waiting for checkpoint completion:",
      expect.any(Error),
    );
  });
});
