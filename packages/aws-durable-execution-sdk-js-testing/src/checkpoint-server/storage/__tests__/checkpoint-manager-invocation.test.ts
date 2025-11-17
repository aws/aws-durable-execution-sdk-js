import { CheckpointManager } from "../checkpoint-manager";
import {
  createExecutionId,
  createInvocationId,
} from "../../utils/tagged-strings";

// Mock crypto's randomUUID function
jest.mock("node:crypto", () => ({
  randomUUID: jest.fn().mockReturnValue("mocked-uuid"),
}));

describe("CheckpointManager Invocation Methods", () => {
  let storage: CheckpointManager;

  beforeEach(() => {
    storage = new CheckpointManager(createExecutionId("test-execution-id"));
    jest.clearAllMocks();
  });

  afterEach(() => {
    storage.cleanup();
  });

  describe("startInvocation", () => {
    it("should store invocation with current timestamp", () => {
      const invocationId = createInvocationId("test-invocation-1");
      const beforeTimestamp = new Date();

      storage.startInvocation(invocationId);

      const afterTimestamp = new Date();

      // Verify invocation was stored by trying to complete it
      const result = storage.completeInvocation(invocationId);

      expect(result.startTimestamp).toBeInstanceOf(Date);
      expect(result.startTimestamp.getTime()).toBeGreaterThanOrEqual(
        beforeTimestamp.getTime(),
      );
      expect(result.startTimestamp.getTime()).toBeLessThanOrEqual(
        afterTimestamp.getTime(),
      );
    });

    it("should allow multiple invocations to be started", () => {
      const invocation1 = createInvocationId("invocation-1");
      const invocation2 = createInvocationId("invocation-2");

      storage.startInvocation(invocation1);
      storage.startInvocation(invocation2);

      // Both should be retrievable
      const result1 = storage.completeInvocation(invocation1);
      const result2 = storage.completeInvocation(invocation2);

      expect(result1.startTimestamp).toBeInstanceOf(Date);
      expect(result2.startTimestamp).toBeInstanceOf(Date);
    });
  });

  describe("completeInvocation", () => {
    it("should return start and end timestamps for valid invocation", () => {
      const invocationId = createInvocationId("test-completion");
      const beforeStart = new Date();

      storage.startInvocation(invocationId);

      const beforeEnd = new Date();
      const result = storage.completeInvocation(invocationId);
      const afterEnd = new Date();

      expect(result).toEqual({
        startTimestamp: expect.any(Date),
        endTimestamp: expect.any(Date),
      });

      expect(result.startTimestamp.getTime()).toBeGreaterThanOrEqual(
        beforeStart.getTime(),
      );
      expect(result.startTimestamp.getTime()).toBeLessThanOrEqual(
        beforeEnd.getTime(),
      );
      expect(result.endTimestamp.getTime()).toBeGreaterThanOrEqual(
        beforeEnd.getTime(),
      );
      expect(result.endTimestamp.getTime()).toBeLessThanOrEqual(
        afterEnd.getTime(),
      );
      expect(result.endTimestamp.getTime()).toBeGreaterThanOrEqual(
        result.startTimestamp.getTime(),
      );
    });

    it("should throw error for non-existent invocation", () => {
      const nonExistentId = createInvocationId("does-not-exist");

      expect(() => {
        storage.completeInvocation(nonExistentId);
      }).toThrow(`Invocation with ID ${nonExistentId} not found`);
    });

    it("should throw error when completing same invocation twice", () => {
      const invocationId = createInvocationId("double-complete");

      storage.startInvocation(invocationId);

      // First completion should succeed
      const result = storage.completeInvocation(invocationId);
      expect(result.startTimestamp).toBeInstanceOf(Date);
      expect(result.endTimestamp).toBeInstanceOf(Date);

      // Second completion should fail
      expect(() => {
        storage.completeInvocation(invocationId);
      }).toThrow(`Invocation with ID ${invocationId} not found`);
    });

    it("should handle multiple invocations independently", () => {
      const invocation1 = createInvocationId("multi-1");
      const invocation2 = createInvocationId("multi-2");
      const invocation3 = createInvocationId("multi-3");

      // Start all invocations
      storage.startInvocation(invocation1);
      storage.startInvocation(invocation2);
      storage.startInvocation(invocation3);

      // Complete them in different order
      const result2 = storage.completeInvocation(invocation2);
      const result1 = storage.completeInvocation(invocation1);
      const result3 = storage.completeInvocation(invocation3);

      // All should have valid timestamps
      expect(result1.startTimestamp).toBeInstanceOf(Date);
      expect(result1.endTimestamp).toBeInstanceOf(Date);
      expect(result2.startTimestamp).toBeInstanceOf(Date);
      expect(result2.endTimestamp).toBeInstanceOf(Date);
      expect(result3.startTimestamp).toBeInstanceOf(Date);
      expect(result3.endTimestamp).toBeInstanceOf(Date);

      // All should be removed after completion
      expect(() => storage.completeInvocation(invocation1)).toThrow();
      expect(() => storage.completeInvocation(invocation2)).toThrow();
      expect(() => storage.completeInvocation(invocation3)).toThrow();
    });
  });
});
