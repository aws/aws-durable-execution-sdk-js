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

  it("should terminate immediately - active operations check moved to waitBeforeContinue", async () => {
    // Simulate an active operation
    tracker.increment();

    const _terminatePromise = terminate(
      mockContext,
      TerminationReason.CALLBACK_PENDING,
      "Callback pending",
    );

    // Should terminate immediately - active operations check is now in waitBeforeContinue
    expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith({
      reason: TerminationReason.CALLBACK_PENDING,
      message: "Callback pending",
    });
  });

  it("should terminate immediately in parallel scenario - active operations check moved to waitBeforeContinue", async () => {
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

    // Should terminate immediately - active operations check is now in waitBeforeContinue
    expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith({
      reason: TerminationReason.CALLBACK_PENDING,
      message: "Branch 2 callback pending",
    });
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
