import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";
import { withDurableExecution } from "./with-durable-execution";
import { initializeExecutionContext } from "./context/execution-context/execution-context";
import { createDurableContext } from "./context/durable-context/durable-context";
import { Context } from "aws-lambda";
import { DurableExecutionInvocationInput } from "./types";
import { log } from "./utils/logger/logger";
import { CheckpointManager } from "./utils/checkpoint/checkpoint-manager";
import { TerminationReason } from "./termination-manager/types";

// Mock dependencies
vi.mock("./context/execution-context/execution-context");
vi.mock("./context/durable-context/durable-context");
vi.mock("./utils/logger/logger", () => ({
  log: vi.fn(),
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
    vi.clearAllMocks();

    mockTerminationManager = {
      getTerminationPromise: vi.fn().mockReturnValue(new Promise(() => {})),
      terminate: vi.fn(),
      setCheckpointTerminatingCallback: vi.fn(),
    };

    mockExecutionContext = {
      state: {},
      _stepData: {},
      terminationManager: mockTerminationManager,
      durableExecutionArn: "test-arn",

      pendingCompletions: new Set(),
    };

    (initializeExecutionContext as Mock).mockResolvedValue({
      executionContext: mockExecutionContext,
      durableExecutionMode: "NORMAL",
      checkpointToken: "test-token",
    });

    (createDurableContext as Mock).mockImplementation(
      (_ctx, _lambdaCtx, _mode, _logger, _opts, _durableExecution) => {
        return {};
      },
    );
  });

  it("should wait for checkpoint queue completion on successful handler execution", async () => {
    const waitSpy = vi
      .spyOn(CheckpointManager.prototype, "waitForQueueCompletion")
      .mockResolvedValue(undefined);
    const clearSpy = vi.spyOn(CheckpointManager.prototype, "clearQueue");

    const mockHandler = vi.fn().mockResolvedValue("success");
    const wrappedHandler = withDurableExecution(mockHandler);

    await wrappedHandler(mockEvent, mockContext);

    // waitForQueueCompletion is called once in the success path
    expect(waitSpy).toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();

    waitSpy.mockRestore();
    clearSpy.mockRestore();
  });

  it("should wait for queue completion even on termination", async () => {
    const waitSpy = vi
      .spyOn(CheckpointManager.prototype, "waitForQueueCompletion")
      .mockResolvedValue(undefined);

    // Mock handler to take longer so termination wins the race
    const mockHandler = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve("success"), 1000)),
      );

    // Mock termination promise to resolve immediately
    mockTerminationManager.getTerminationPromise.mockResolvedValue({
      reason: TerminationReason.WAIT_SCHEDULED,
      message: "Wait scheduled",
    });

    const wrappedHandler = withDurableExecution(mockHandler);

    await wrappedHandler(mockEvent, mockContext);

    expect(waitSpy).toHaveBeenCalledTimes(1);

    waitSpy.mockRestore();
  });

  it("should handle waitForQueueCompletion errors gracefully", async () => {
    const waitSpy = vi
      .spyOn(CheckpointManager.prototype, "waitForQueueCompletion")
      .mockRejectedValue(new Error("Queue completion failed"));

    const mockHandler = vi.fn().mockResolvedValue("success");
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
