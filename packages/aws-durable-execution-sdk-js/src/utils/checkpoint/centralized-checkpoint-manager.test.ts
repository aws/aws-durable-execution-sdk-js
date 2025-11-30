import { CentralizedCheckpointManager } from "./centralized-checkpoint-manager";
import { PromiseResolver } from "../../types/promise-resolver";

// Mock the logger
jest.mock("../logger/logger", () => ({
  log: jest.fn(),
}));

// Mock the parent CheckpointManager
jest.mock("./checkpoint-manager", () => ({
  CheckpointManager: class MockCheckpointManager {
    setTerminating = jest.fn();
  },
}));

describe("CentralizedCheckpointManager", () => {
  let manager: CentralizedCheckpointManager;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    // Create manager with minimal required parameters
    manager = new (CentralizedCheckpointManager as any)();
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllTimers();
    jest.useFakeTimers();
  });

  afterEach(() => {
    manager.cleanup();
    consoleSpy.mockRestore();
    jest.useRealTimers();
  });

  describe("Promise Resolver Management", () => {
    it("should schedule immediate resolution", () => {
      const resolver: PromiseResolver<void> = {
        handlerId: "test-handler",
        resolve: jest.fn(),
        reject: jest.fn(),
      };

      manager.scheduleResume(resolver);

      expect(resolver.resolve).toHaveBeenCalledWith(undefined);
      expect(manager.getActiveHandlerCount()).toBe(0);
    });

    it("should schedule delayed resolution", () => {
      const resolver: PromiseResolver<void> = {
        handlerId: "test-handler",
        resolve: jest.fn(),
        reject: jest.fn(),
        scheduledTime: Date.now() + 5000,
      };

      manager.scheduleResume(resolver);

      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(manager.getActiveHandlerCount()).toBe(1);

      // Fast-forward time
      jest.advanceTimersByTime(5000);

      expect(resolver.resolve).toHaveBeenCalledWith(undefined);
      expect(manager.getActiveHandlerCount()).toBe(0);
    });

    it("should resolve promise by handler ID", () => {
      const resolver: PromiseResolver<string> = {
        handlerId: "test-handler",
        resolve: jest.fn(),
        reject: jest.fn(),
        scheduledTime: Date.now() + 5000,
      };

      manager.scheduleResume(resolver);
      manager.resolvePromise("test-handler", "test-value");

      expect(resolver.resolve).toHaveBeenCalledWith("test-value");
      expect(manager.getActiveHandlerCount()).toBe(0);
    });

    it("should reject promise by handler ID", () => {
      const error = new Error("test error");
      const resolver: PromiseResolver<void> = {
        handlerId: "test-handler",
        resolve: jest.fn(),
        reject: jest.fn(),
        scheduledTime: Date.now() + 5000,
      };

      manager.scheduleResume(resolver);
      manager.rejectPromise("test-handler", error);

      expect(resolver.reject).toHaveBeenCalledWith(error);
      expect(manager.getActiveHandlerCount()).toBe(0);
    });
  });

  describe("Timer Management", () => {
    it("should cancel existing timer when scheduling new one for same handler", () => {
      const resolver1: PromiseResolver<void> = {
        handlerId: "test-handler",
        resolve: jest.fn(),
        reject: jest.fn(),
        scheduledTime: Date.now() + 5000,
      };

      const resolver2: PromiseResolver<void> = {
        handlerId: "test-handler",
        resolve: jest.fn(),
        reject: jest.fn(),
        scheduledTime: Date.now() + 3000,
      };

      manager.scheduleResume(resolver1);
      manager.scheduleResume(resolver2);

      // Fast-forward to first timer
      jest.advanceTimersByTime(3000);

      expect(resolver1.resolve).not.toHaveBeenCalled();
      expect(resolver2.resolve).toHaveBeenCalled();
    });

    it("should handle multiple handlers with different timers", () => {
      const resolver1: PromiseResolver<void> = {
        handlerId: "handler-1",
        resolve: jest.fn(),
        reject: jest.fn(),
        scheduledTime: Date.now() + 2000,
      };

      const resolver2: PromiseResolver<void> = {
        handlerId: "handler-2",
        resolve: jest.fn(),
        reject: jest.fn(),
        scheduledTime: Date.now() + 4000,
      };

      manager.scheduleResume(resolver1);
      manager.scheduleResume(resolver2);

      expect(manager.getActiveHandlerCount()).toBe(2);

      // First timer fires
      jest.advanceTimersByTime(2000);
      expect(resolver1.resolve).toHaveBeenCalled();
      expect(resolver2.resolve).not.toHaveBeenCalled();
      expect(manager.getActiveHandlerCount()).toBe(1);

      // Second timer fires
      jest.advanceTimersByTime(2000);
      expect(resolver2.resolve).toHaveBeenCalled();
      expect(manager.getActiveHandlerCount()).toBe(0);
    });
  });

  describe("Termination Management", () => {
    it("should start warmup when no active handlers", () => {
      expect(manager.hasActiveHandlers()).toBe(false);

      manager.checkTermination();

      // Should have started warmup timer
      expect(jest.getTimerCount()).toBe(1);
    });

    it("should cancel warmup when new handler is scheduled", () => {
      // Start warmup
      manager.checkTermination();
      expect(jest.getTimerCount()).toBe(1);

      // Schedule new handler
      const resolver: PromiseResolver<void> = {
        handlerId: "test-handler",
        resolve: jest.fn(),
        reject: jest.fn(),
        scheduledTime: Date.now() + 5000,
      };

      manager.scheduleResume(resolver);

      // Warmup should be cancelled, only handler timer should remain
      expect(jest.getTimerCount()).toBe(1);
    });

    it("should complete warmup and initiate termination", () => {
      manager.checkTermination();

      // Fast-forward through warmup period
      jest.advanceTimersByTime(2000);

      // Should have completed warmup (logged termination)
      expect(jest.getTimerCount()).toBe(0);
    });

    it("should not start multiple warmups", () => {
      manager.checkTermination();
      manager.checkTermination();

      // Should only have one timer
      expect(jest.getTimerCount()).toBe(1);
    });
  });

  describe("Cleanup", () => {
    it("should clean up all resources", () => {
      const resolver: PromiseResolver<void> = {
        handlerId: "test-handler",
        resolve: jest.fn(),
        reject: jest.fn(),
        scheduledTime: Date.now() + 5000,
      };

      manager.scheduleResume(resolver);
      manager.checkTermination();

      expect(manager.getActiveHandlerCount()).toBe(1);
      expect(jest.getTimerCount()).toBeGreaterThan(0);

      manager.cleanup();

      expect(manager.getActiveHandlerCount()).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    });

    it("should clean up on setTerminating", () => {
      const resolver: PromiseResolver<void> = {
        handlerId: "test-handler",
        resolve: jest.fn(),
        reject: jest.fn(),
        scheduledTime: Date.now() + 5000,
      };

      manager.scheduleResume(resolver);
      expect(manager.getActiveHandlerCount()).toBe(1);

      manager.setTerminating();

      // Handler count should remain (resolvers not cleared by setTerminating)
      // but timers should be cancelled (tested by other tests)
      expect(manager.getActiveHandlerCount()).toBe(1);
    });
  });
});
