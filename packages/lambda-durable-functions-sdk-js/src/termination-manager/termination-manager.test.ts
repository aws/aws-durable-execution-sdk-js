import { TerminationManager } from "./termination-manager";
import { TerminationReason } from "./types";

describe("TerminationManager", () => {
  let terminationManager: TerminationManager;

  beforeEach(() => {
    terminationManager = new TerminationManager();
    jest.resetAllMocks();
  });

  it("should not be terminated by default", () => {
    // Access private property for testing
    expect((terminationManager as any).isTerminated).toBe(false);
  });

  it("should create a termination promise", () => {
    expect(terminationManager.getTerminationPromise()).toBeInstanceOf(Promise);
  });

  it("should terminate with default reason", async () => {
    // Setup a listener for the termination promise
    const terminationPromise = terminationManager.getTerminationPromise();

    // Terminate
    terminationManager.terminate();

    // Verify
    const result = await terminationPromise;
    expect(result.reason).toBe(TerminationReason.OPERATION_TERMINATED);
    expect(result.message).toBe("Operation terminated");
  });

  it("should terminate with custom reason and message", async () => {
    // Setup a listener for the termination promise
    const terminationPromise = terminationManager.getTerminationPromise();

    // Terminate with custom reason and message
    terminationManager.terminate({
      reason: TerminationReason.RETRY_SCHEDULED,
      message: "Custom message",
    });

    // Verify
    const result = await terminationPromise;
    expect(result.reason).toBe(TerminationReason.RETRY_SCHEDULED);
    expect(result.message).toBe("Custom message");
  });

  it("should ignore subsequent terminate calls", async () => {
    // Setup a listener for the termination promise
    const terminationPromise = terminationManager.getTerminationPromise();

    // Terminate twice with different reasons
    terminationManager.terminate({
      reason: TerminationReason.RETRY_SCHEDULED,
      message: "First termination",
    });

    terminationManager.terminate({
      reason: TerminationReason.WAIT_SCHEDULED,
      message: "Second termination",
    });

    // Verify only the first termination was processed
    const result = await terminationPromise;
    expect(result.reason).toBe(TerminationReason.RETRY_SCHEDULED);
    expect(result.message).toBe("First termination");
  });

  it("should execute cleanup function if provided", async () => {
    // Setup
    const cleanup = jest.fn().mockResolvedValue(undefined);
    const terminationPromise = terminationManager.getTerminationPromise();

    // Terminate with cleanup
    terminationManager.terminate({
      reason: TerminationReason.OPERATION_TERMINATED,
      cleanup,
    });

    // Wait for termination to complete
    await terminationPromise;

    // Verify cleanup was called
    expect(cleanup).toHaveBeenCalled();
  });

  it("should handle errors in cleanup function", async () => {
    // Setup
    const cleanup = jest.fn().mockRejectedValue(new Error("Cleanup error"));
    const terminationPromise = terminationManager.getTerminationPromise();

    // Terminate with failing cleanup
    terminationManager.terminate({
      reason: TerminationReason.OPERATION_TERMINATED,
      cleanup,
    });

    // Verify termination still completes despite cleanup error
    const result = await terminationPromise;
    expect(result.reason).toBe(TerminationReason.OPERATION_TERMINATED);
    expect(cleanup).toHaveBeenCalled();
  });

  it("should win Promise.race against a longer-running promise", async () => {
    // This spy will help us track which promise resolved first
    const raceSpy = jest.fn();

    // Create a promise that will take some time to resolve
    const longRunningPromise = new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve("long-running");
      }, 100); // 100ms delay
    }).then((result) => {
      raceSpy("long-running");
      return result;
    });

    // Get the termination promise
    const terminationPromise = terminationManager
      .getTerminationPromise()
      .then((result) => {
        raceSpy("termination");
        return result;
      });

    // Set up the Promise.race
    const racePromise = Promise.race([longRunningPromise, terminationPromise]);

    // Allow a small delay to ensure Promise.race is set up
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Now trigger termination
    terminationManager.terminate({
      reason: TerminationReason.CHECKPOINT_FAILED,
      message: "Test termination",
    });

    // Wait for the race to complete
    const result = await racePromise;

    // Assertions
    expect(raceSpy).toHaveBeenCalledTimes(1); // Only one promise should have resolved
    expect(raceSpy).toHaveBeenCalledWith("termination"); // The termination promise should have won
    expect(result).toEqual(
      expect.objectContaining({
        reason: TerminationReason.CHECKPOINT_FAILED,
        message: "Test termination",
      }),
    );
  });
});
