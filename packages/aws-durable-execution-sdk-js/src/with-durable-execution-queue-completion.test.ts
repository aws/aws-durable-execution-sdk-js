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

  it("should wait for checkpoint queue completion on successful handler execution", async () => {
    const waitSpy = jest
      .spyOn(CheckpointManager.prototype, "waitForQueueCompletion")
      .mockResolvedValue(undefined);
    const clearSpy = jest.spyOn(CheckpointManager.prototype, "clearQueue");

    const mockHandler = jest.fn().mockResolvedValue("success");
    const wrappedHandler = withDurableExecution(mockHandler);

    await wrappedHandler(mockEvent, mockContext);

    expect(waitSpy).toHaveBeenCalledTimes(1);
    expect(clearSpy).not.toHaveBeenCalled();

    waitSpy.mockRestore();
    clearSpy.mockRestore();
  });

  it("should clear queue on termination without waiting", async () => {
    const waitSpy = jest.spyOn(
      CheckpointManager.prototype,
      "waitForQueueCompletion",
    );
    const clearSpy = jest
      .spyOn(CheckpointManager.prototype, "clearQueue")
      .mockImplementation(() => {});

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

    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(waitSpy).not.toHaveBeenCalled();

    waitSpy.mockRestore();
    clearSpy.mockRestore();
  });

  it("should handle waitForQueueCompletion timeout gracefully", async () => {
    const longRunningPromise = new Promise((resolve) =>
      setTimeout(resolve, 15000),
    );
    const waitSpy = jest
      .spyOn(CheckpointManager.prototype, "waitForQueueCompletion")
      .mockReturnValue(longRunningPromise as any);

    const mockHandler = jest.fn().mockResolvedValue("success");
    const wrappedHandler = withDurableExecution(mockHandler);

    const startTime = Date.now();
    await wrappedHandler(mockEvent, mockContext);
    const endTime = Date.now();

    // Should complete within timeout period (10 seconds + some buffer)
    expect(endTime - startTime).toBeLessThan(12000);
    expect(waitSpy).toHaveBeenCalledTimes(1);

    waitSpy.mockRestore();
  }, 15000);

  it("should handle waitForQueueCompletion errors gracefully", async () => {
    const waitSpy = jest
      .spyOn(CheckpointManager.prototype, "waitForQueueCompletion")
      .mockRejectedValue(new Error("Queue completion failed"));

    const mockHandler = jest.fn().mockResolvedValue("success");
    const wrappedHandler = withDurableExecution(mockHandler);

    // Should not throw despite waitForQueueCompletion error
    await expect(wrappedHandler(mockEvent, mockContext)).resolves.toBeDefined();
    expect(log).toHaveBeenCalledWith(
      "⚠️",
      "Error waiting for checkpoint completion:",
      expect.any(Error),
    );

    waitSpy.mockRestore();
  });
});
