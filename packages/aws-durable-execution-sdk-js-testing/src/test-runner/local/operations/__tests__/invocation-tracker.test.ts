import { InvocationTracker } from "../invocation-tracker";
import { createInvocationId } from "../../../../checkpoint-server/utils/tagged-strings";

describe("InvocationTracker", () => {
  let invocationTracker: InvocationTracker;

  beforeEach(() => {
    invocationTracker = new InvocationTracker();
  });

  describe("constructor", () => {
    it("should initialize with an empty invocations array", () => {
      expect(invocationTracker.getInvocations()).toEqual([]);
    });
  });

  describe("reset", () => {
    it("should clear all invocations", () => {
      // Setup: Add some invocations
      const invocationId1 = createInvocationId("test-invocation-1");
      const invocationId2 = createInvocationId("test-invocation-2");
      invocationTracker.createInvocation(invocationId1);
      invocationTracker.createInvocation(invocationId2);

      // Verify setup worked
      expect(invocationTracker.getInvocations().length).toBe(2);

      // Act: Reset the tracker
      invocationTracker.reset();

      // Assert: All data should be cleared
      expect(invocationTracker.getInvocations()).toEqual([]);
    });
  });

  describe("createInvocation", () => {
    it("should create and return an invocation object with the given ID", () => {
      const invocationId = createInvocationId("test-invocation");

      const invocation = invocationTracker.createInvocation(invocationId);

      expect(invocation.id).toBe(invocationId);
    });

    it("should add the created invocation to the invocations list", () => {
      const invocationId = createInvocationId("test-invocation");

      invocationTracker.createInvocation(invocationId);

      const invocations = invocationTracker.getInvocations();
      expect(invocations.length).toBe(1);
      expect(invocations[0].id).toBe(invocationId);
    });

    it("should create unique invocation objects for different IDs", () => {
      const invocationId1 = createInvocationId("test-invocation-1");
      const invocationId2 = createInvocationId("test-invocation-2");

      const invocation1 = invocationTracker.createInvocation(invocationId1);
      const invocation2 = invocationTracker.createInvocation(invocationId2);

      expect(invocation1.id).toBe(invocationId1);
      expect(invocation2.id).toBe(invocationId2);
      expect(invocation1).not.toBe(invocation2);

      const invocations = invocationTracker.getInvocations();
      expect(invocations.length).toBe(2);
      expect(invocations[0].id).toBe(invocationId1);
      expect(invocations[1].id).toBe(invocationId2);
    });
  });

  describe("getInvocations", () => {
    it("should return all created invocations", () => {
      const invocationId1 = createInvocationId("test-invocation-1");
      const invocationId2 = createInvocationId("test-invocation-2");

      invocationTracker.createInvocation(invocationId1);
      invocationTracker.createInvocation(invocationId2);

      const invocations = invocationTracker.getInvocations();

      expect(invocations.length).toBe(2);
      expect(invocations[0].id).toBe(invocationId1);
      expect(invocations[1].id).toBe(invocationId2);
    });

    it("should return a copy of the invocations array", () => {
      const invocationId = createInvocationId("test-invocation");
      invocationTracker.createInvocation(invocationId);

      const invocations1 = invocationTracker.getInvocations();
      expect(invocations1.length).toBe(1);

      // Modifying the returned array should not affect the internal state
      invocations1.pop();

      const invocations2 = invocationTracker.getInvocations();
      expect(invocations2.length).toBe(1); // Should still have the invocation
    });

    it("should return an empty array when no invocations exist", () => {
      const invocations = invocationTracker.getInvocations();
      expect(invocations).toEqual([]);
    });
  });

  describe("hasActiveInvocation", () => {
    it("should return false when no invocations exist", () => {
      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });

    it("should return true when invocations exist but none are completed", () => {
      const invocationId1 = createInvocationId("test-invocation-1");
      const invocationId2 = createInvocationId("test-invocation-2");

      invocationTracker.createInvocation(invocationId1);
      invocationTracker.createInvocation(invocationId2);

      expect(invocationTracker.hasActiveInvocation()).toBe(true);
    });

    it("should return false when all invocations are completed", () => {
      const invocationId1 = createInvocationId("test-invocation-1");
      const invocationId2 = createInvocationId("test-invocation-2");

      invocationTracker.createInvocation(invocationId1);
      invocationTracker.createInvocation(invocationId2);

      // Complete both invocations
      invocationTracker.completeInvocation(invocationId1);
      invocationTracker.completeInvocation(invocationId2);

      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });

    it("should return true when some but not all invocations are completed", () => {
      const invocationId1 = createInvocationId("test-invocation-1");
      const invocationId2 = createInvocationId("test-invocation-2");
      const invocationId3 = createInvocationId("test-invocation-3");

      invocationTracker.createInvocation(invocationId1);
      invocationTracker.createInvocation(invocationId2);
      invocationTracker.createInvocation(invocationId3);

      // Complete only first two invocations
      invocationTracker.completeInvocation(invocationId1);
      invocationTracker.completeInvocation(invocationId2);

      expect(invocationTracker.hasActiveInvocation()).toBe(true);
    });

    it("should handle single invocation lifecycle correctly", () => {
      const invocationId = createInvocationId("test-invocation");

      // No invocations - should be false
      expect(invocationTracker.hasActiveInvocation()).toBe(false);

      // Create invocation - should be true (active)
      invocationTracker.createInvocation(invocationId);
      expect(invocationTracker.hasActiveInvocation()).toBe(true);

      // Complete invocation - should be false (no active)
      invocationTracker.completeInvocation(invocationId);
      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });
  });

  describe("completeInvocation", () => {
    it("should mark a single invocation as completed", () => {
      const invocationId = createInvocationId("test-invocation");

      invocationTracker.createInvocation(invocationId);
      expect(invocationTracker.hasActiveInvocation()).toBe(true);

      invocationTracker.completeInvocation(invocationId);
      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });

    it("should handle completing multiple invocations", () => {
      const invocationId1 = createInvocationId("test-invocation-1");
      const invocationId2 = createInvocationId("test-invocation-2");
      const invocationId3 = createInvocationId("test-invocation-3");

      invocationTracker.createInvocation(invocationId1);
      invocationTracker.createInvocation(invocationId2);
      invocationTracker.createInvocation(invocationId3);

      expect(invocationTracker.hasActiveInvocation()).toBe(true);

      // Complete them one by one and verify state
      invocationTracker.completeInvocation(invocationId1);
      expect(invocationTracker.hasActiveInvocation()).toBe(true); // Still 2 active

      invocationTracker.completeInvocation(invocationId2);
      expect(invocationTracker.hasActiveInvocation()).toBe(true); // Still 1 active

      invocationTracker.completeInvocation(invocationId3);
      expect(invocationTracker.hasActiveInvocation()).toBe(false); // All completed
    });

    it("should handle completing the same invocation multiple times", () => {
      const invocationId = createInvocationId("test-invocation");

      invocationTracker.createInvocation(invocationId);
      expect(invocationTracker.hasActiveInvocation()).toBe(true);

      // Complete the same invocation multiple times
      invocationTracker.completeInvocation(invocationId);
      invocationTracker.completeInvocation(invocationId);
      invocationTracker.completeInvocation(invocationId);

      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });

    it("should handle completing non-existent invocations gracefully", () => {
      const nonExistentId = createInvocationId("non-existent");
      const existingId = createInvocationId("existing");

      invocationTracker.createInvocation(existingId);
      expect(invocationTracker.hasActiveInvocation()).toBe(true);

      // Try to complete a non-existent invocation
      invocationTracker.completeInvocation(nonExistentId);

      // Existing invocation should still be active
      expect(invocationTracker.hasActiveInvocation()).toBe(true);

      // Complete the existing one
      invocationTracker.completeInvocation(existingId);
      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });
  });

  describe("reset with new completion tracking", () => {
    it("should clear completion tracking when reset", () => {
      const invocationId1 = createInvocationId("test-invocation-1");
      const invocationId2 = createInvocationId("test-invocation-2");

      invocationTracker.createInvocation(invocationId1);
      invocationTracker.createInvocation(invocationId2);
      invocationTracker.completeInvocation(invocationId1);

      expect(invocationTracker.hasActiveInvocation()).toBe(true); // One still active

      // Reset should clear everything
      invocationTracker.reset();

      expect(invocationTracker.hasActiveInvocation()).toBe(false); // No invocations
      expect(invocationTracker.getInvocations()).toEqual([]);

      // After reset, creating new invocations should work normally
      const newInvocationId = createInvocationId("new-invocation");
      invocationTracker.createInvocation(newInvocationId);
      expect(invocationTracker.hasActiveInvocation()).toBe(true);
    });
  });
});
