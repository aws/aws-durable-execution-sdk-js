import { terminate } from "./termination-helper";
import { ExecutionContext } from "../../types";
import { TerminationReason } from "../../termination-manager/types";
import { ActiveOperationsTracker } from "./active-operations-tracker";

describe("termination deferral with active operations", () => {
  let mockContext: jest.Mocked<ExecutionContext>;
  let tracker: ActiveOperationsTracker;

  beforeEach(() => {
    tracker = new ActiveOperationsTracker();
    mockContext = {
      terminationManager: {
        terminate: jest.fn(),
      },
      activeOperationsTracker: tracker,
    } as any;
  });

  it("should terminate immediately when no active operations", () => {
    terminate(mockContext, TerminationReason.WAIT_SCHEDULED, "Test message");

    expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith({
      reason: TerminationReason.WAIT_SCHEDULED,
      message: "Test message",
    });
  });

  it("should defer termination when operations are active", async () => {
    // Simulate an active operation
    tracker.increment();

    const _terminatePromise = terminate(
      mockContext,
      TerminationReason.CALLBACK_PENDING,
      "Callback pending",
    );

    // Should not terminate immediately
    expect(mockContext.terminationManager.terminate).not.toHaveBeenCalled();

    // Complete the operation after a delay
    setTimeout(() => {
      tracker.decrement();
    }, 50);

    // Wait a bit longer for the check interval to detect completion
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Now termination should have been called
    expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith({
      reason: TerminationReason.CALLBACK_PENDING,
      message: "Callback pending",
    });
  });

  it("should handle parallel scenario with minSuccessful", async () => {
    // Simulate parallel with 2 branches
    // Branch 1: completes successfully (checkpoint in progress)
    // Branch 2: tries to terminate (callback pending)

    // Branch 1 starts checkpoint
    tracker.increment();

    // Branch 2 tries to terminate
    const _terminatePromise = terminate(
      mockContext,
      TerminationReason.CALLBACK_PENDING,
      "Branch 2 callback pending",
    );

    // Termination should be deferred
    expect(mockContext.terminationManager.terminate).not.toHaveBeenCalled();

    // Branch 1 completes checkpoint
    setTimeout(() => {
      tracker.decrement();
    }, 30);

    // Wait for termination to proceed
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Now termination should proceed
    expect(mockContext.terminationManager.terminate).toHaveBeenCalled();
  });

  it("should work without tracker (backward compatibility)", () => {
    const contextWithoutTracker = {
      terminationManager: {
        terminate: jest.fn(),
      },
      activeOperationsTracker: undefined,
    } as any;

    terminate(contextWithoutTracker, TerminationReason.WAIT_SCHEDULED, "Test");

    expect(
      contextWithoutTracker.terminationManager.terminate,
    ).toHaveBeenCalled();
  });
});
