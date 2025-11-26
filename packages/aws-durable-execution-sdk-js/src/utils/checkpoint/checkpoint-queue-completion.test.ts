import { CheckpointManager } from "./checkpoint-manager";
import { createMockExecutionContext } from "../../testing/mock-context";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { EventEmitter } from "events";
import { createDefaultLogger } from "../logger/default-logger";

jest.mock("../../utils/logger/logger", () => ({
  log: jest.fn(),
}));

describe("CheckpointManager Queue Completion", () => {
  let checkpointManager: CheckpointManager;
  let mockContext: any;
  let mockTerminationManager: TerminationManager;
  let mockEmitter: EventEmitter;
  let mockLogger: any;

  beforeEach(() => {
    mockContext = createMockExecutionContext();
    mockTerminationManager = new TerminationManager();
    mockEmitter = new EventEmitter();
    mockLogger = createDefaultLogger();

    checkpointManager = new CheckpointManager(
      "test-arn",
      mockContext._stepData,
      mockContext.state,
      mockTerminationManager,
      undefined,
      "test-token",
      mockEmitter,
      mockLogger,
      new Set<string>(),
    );
  });

  describe("waitForQueueCompletion", () => {
    it("should resolve immediately when queue is empty", async () => {
      await expect(
        checkpointManager.waitForQueueCompletion(),
      ).resolves.toBeUndefined();
    });

    it("should wait until queue is empty", async () => {
      const mockCheckpoint = jest
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({}), 200)),
        );
      (checkpointManager as any).storage = { checkpoint: mockCheckpoint };

      // Add item to queue
      checkpointManager.checkpoint("test-step", {});

      // Should wait for queue to empty
      await expect(
        checkpointManager.waitForQueueCompletion(),
      ).resolves.toBeUndefined();
      expect(mockCheckpoint).toHaveBeenCalled();
    });

    it("should handle multiple concurrent waits", async () => {
      const waits = Promise.all([
        checkpointManager.waitForQueueCompletion(),
        checkpointManager.waitForQueueCompletion(),
        checkpointManager.waitForQueueCompletion(),
      ]);

      await expect(waits).resolves.toEqual([undefined, undefined, undefined]);
    });

    it("should timeout after 3 seconds if queue doesn't complete", async () => {
      jest.useFakeTimers();

      const mockCheckpoint = jest.fn().mockImplementation(
        () => new Promise(() => {}), // Never resolves
      );
      (checkpointManager as any).storage = { checkpoint: mockCheckpoint };

      // Add item to queue
      checkpointManager.checkpoint("test-step", {});

      const waitPromise = checkpointManager.waitForQueueCompletion();

      // Fast-forward time by 3 seconds
      jest.advanceTimersByTime(3000);

      await expect(waitPromise).rejects.toThrow(
        "Timeout waiting for checkpoint queue completion",
      );

      jest.useRealTimers();
    });

    it("should clear queue on timeout", async () => {
      jest.useFakeTimers();

      const mockCheckpoint = jest.fn().mockImplementation(
        () => new Promise(() => {}), // Never resolves
      );
      (checkpointManager as any).storage = { checkpoint: mockCheckpoint };

      // Add items to queue
      checkpointManager.checkpoint("test-step-1", {});
      checkpointManager.checkpoint("test-step-2", {});

      expect((checkpointManager as any).queue.length).toBe(2);

      const waitPromise = checkpointManager.waitForQueueCompletion();

      // Fast-forward time by 3 seconds
      jest.advanceTimersByTime(3000);

      await expect(waitPromise).rejects.toThrow(
        "Timeout waiting for checkpoint queue completion",
      );

      // Queue should be cleared
      expect((checkpointManager as any).queue.length).toBe(0);

      jest.useRealTimers();
    });
  });

  describe("clearQueue", () => {
    it("should clear the queue", () => {
      const mockCheckpoint = jest.fn().mockResolvedValue({});
      (checkpointManager as any).storage = { checkpoint: mockCheckpoint };

      // Add items to queue
      checkpointManager.checkpoint("test-step-1", {});
      checkpointManager.checkpoint("test-step-2", {});

      expect((checkpointManager as any).queue.length).toBe(2);

      checkpointManager.clearQueue();

      expect((checkpointManager as any).queue.length).toBe(0);
    });

    it("should allow waitForQueueCompletion to resolve after clearQueue", async () => {
      const mockCheckpoint = jest.fn().mockResolvedValue({});
      (checkpointManager as any).storage = { checkpoint: mockCheckpoint };

      // Add item to queue
      checkpointManager.checkpoint("test-step", {});

      // Clear queue
      checkpointManager.clearQueue();

      // Wait should resolve immediately
      await expect(
        checkpointManager.waitForQueueCompletion(),
      ).resolves.toBeUndefined();
    });
  });
});
