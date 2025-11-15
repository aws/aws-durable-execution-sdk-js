import { createWaitHandler } from "./wait-handler";
import { createCheckpoint } from "../../utils/checkpoint/checkpoint";
import { EventEmitter } from "events";
import { ExecutionContext } from "../../types";

describe("Wait Handler - Lazy Evaluation", () => {
  it("should not execute wait until awaited", async () => {
    const mockContext = {
      getStepData: jest.fn().mockReturnValue(null),
    } as unknown as ExecutionContext;

    const mockCheckpoint = jest.fn();
    let stepIdCounter = 0;
    const createStepId = () => `step-${++stepIdCounter}`;
    const hasRunningOperations = jest.fn().mockReturnValue(false);
    const getOperationsEmitter = () => new EventEmitter();

    const waitHandler = createWaitHandler(
      mockContext,
      mockCheckpoint as unknown as ReturnType<typeof createCheckpoint>,
      createStepId,
      hasRunningOperations,
      getOperationsEmitter,
    );

    // Create wait promise but don't await it
    const waitPromise = waitHandler({ seconds: 10 });

    // Checkpoint should NOT be called yet (lazy evaluation)
    expect(mockCheckpoint).not.toHaveBeenCalled();
    expect(mockContext.getStepData).not.toHaveBeenCalled();

    // Now await it - execution starts
    try {
      await waitPromise;
    } catch (err) {
      // Expected to terminate
    }

    // Now checkpoint should be called
    expect(mockCheckpoint).toHaveBeenCalled();
  });

  it("should allow Promise.race without eager execution", async () => {
    const mockContext = {
      getStepData: jest.fn().mockReturnValue(null),
    } as unknown as ExecutionContext;

    const mockCheckpoint = jest.fn();
    let stepIdCounter = 0;
    const createStepId = () => `step-${++stepIdCounter}`;
    const hasRunningOperations = jest.fn().mockReturnValue(false);
    const getOperationsEmitter = () => new EventEmitter();

    const waitHandler = createWaitHandler(
      mockContext,
      mockCheckpoint as unknown as ReturnType<typeof createCheckpoint>,
      createStepId,
      hasRunningOperations,
      getOperationsEmitter,
    );

    // Create multiple wait promises
    const wait1 = waitHandler({ seconds: 10 });
    const wait2 = waitHandler({ seconds: 5 });

    // Neither should execute yet
    expect(mockCheckpoint).not.toHaveBeenCalled();

    // Use Promise.race - both will start executing
    try {
      await Promise.race([wait1, wait2]);
    } catch (err) {
      // Expected to terminate
    }

    // Both should have attempted to checkpoint
    expect(mockCheckpoint).toHaveBeenCalled();
  });
});
