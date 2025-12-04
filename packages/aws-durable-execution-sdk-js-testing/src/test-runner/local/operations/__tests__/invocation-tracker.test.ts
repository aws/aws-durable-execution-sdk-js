import { InvocationTracker } from "../invocation-tracker";
import {
  createExecutionId,
  createInvocationId,
} from "../../../../checkpoint-server/utils/tagged-strings";
import { CheckpointApiClient } from "../../api-client/checkpoint-api-client";

describe("InvocationTracker", () => {
  let invocationTracker: InvocationTracker;
  let mockCheckpointApi: jest.Mocked<CheckpointApiClient>;

  const mockExecutionId = createExecutionId();

  beforeEach(() => {
    mockCheckpointApi = {
      startDurableExecution: jest.fn(),
      pollCheckpointData: jest.fn(),
      updateCheckpointData: jest.fn(),
      startInvocation: jest.fn(),
      completeInvocation: jest.fn((_executionId, invocationId, error) =>
        Promise.resolve({
          InvocationCompletedDetails: {
            StartTimestamp: new Date(),
            EndTimestamp: new Date(),
            Error: {
              Payload: error,
            },
            RequestId: invocationId,
          },
        }),
      ),
    };
    invocationTracker = new InvocationTracker(mockCheckpointApi);
  });

  describe("constructor", () => {
    it("should initialize with an empty invocations array", () => {
      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });
  });

  describe("createInvocation", () => {
    it("should create an invocation with the given ID", () => {
      expect(invocationTracker.hasActiveInvocation()).toBe(false);

      invocationTracker.createInvocation();

      expect(invocationTracker.hasActiveInvocation()).toBe(true);
    });
  });

  describe("hasActiveInvocation", () => {
    it("should return false when no invocations exist", () => {
      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });

    it("should return true when invocations exist but none are completed", () => {
      invocationTracker.createInvocation();
      invocationTracker.createInvocation();

      expect(invocationTracker.hasActiveInvocation()).toBe(true);
    });

    it("should return false when all invocations are completed", async () => {
      const invocationId1 = invocationTracker.createInvocation();
      const invocationId2 = invocationTracker.createInvocation();

      // Complete both invocations
      await invocationTracker.completeInvocation(
        mockExecutionId,
        invocationId1,
        undefined,
      );
      await invocationTracker.completeInvocation(
        mockExecutionId,
        invocationId2,
        undefined,
      );

      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });

    it("should return true when some but not all invocations are completed", async () => {
      const invocationId1 = invocationTracker.createInvocation();
      const invocationId2 = invocationTracker.createInvocation();
      invocationTracker.createInvocation();

      // Complete only first two invocations
      await invocationTracker.completeInvocation(
        mockExecutionId,
        invocationId1,
        undefined,
      );
      await invocationTracker.completeInvocation(
        mockExecutionId,
        invocationId2,
        undefined,
      );

      expect(invocationTracker.hasActiveInvocation()).toBe(true);
    });

    it("should handle single invocation lifecycle correctly", async () => {
      // No invocations - should be false
      expect(invocationTracker.hasActiveInvocation()).toBe(false);

      // Create invocation - should be true (active)
      const invocationId = invocationTracker.createInvocation();
      expect(invocationTracker.hasActiveInvocation()).toBe(true);

      // Complete invocation - should be false (no active)
      await invocationTracker.completeInvocation(
        mockExecutionId,
        invocationId,
        undefined,
      );
      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });
  });

  describe("completeInvocation", () => {
    it("should mark a single invocation as completed", async () => {
      const invocationId = invocationTracker.createInvocation();
      expect(invocationTracker.hasActiveInvocation()).toBe(true);

      await invocationTracker.completeInvocation(
        mockExecutionId,
        invocationId,
        undefined,
      );
      expect(mockCheckpointApi.completeInvocation).toHaveBeenCalledWith(
        mockExecutionId,
        invocationId,
        undefined,
      );
      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });

    it("should mark a single invocation as completed with error", async () => {
      const invocationId = invocationTracker.createInvocation();
      expect(invocationTracker.hasActiveInvocation()).toBe(true);

      await invocationTracker.completeInvocation(
        mockExecutionId,
        invocationId,
        {
          ErrorMessage: "this is my error",
        },
      );
      expect(mockCheckpointApi.completeInvocation).toHaveBeenCalledWith(
        mockExecutionId,
        invocationId,
        {
          ErrorMessage: "this is my error",
        },
      );
      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });

    it("should handle completing multiple invocations", async () => {
      const invocationId1 = invocationTracker.createInvocation();
      const invocationId2 = invocationTracker.createInvocation();
      const invocationId3 = invocationTracker.createInvocation();

      expect(invocationTracker.hasActiveInvocation()).toBe(true);

      // Complete them one by one and verify state
      await invocationTracker.completeInvocation(
        mockExecutionId,
        invocationId1,
        undefined,
      );
      expect(invocationTracker.hasActiveInvocation()).toBe(true); // Still 2 active

      await invocationTracker.completeInvocation(
        mockExecutionId,
        invocationId2,
        undefined,
      );
      expect(invocationTracker.hasActiveInvocation()).toBe(true); // Still 1 active

      await invocationTracker.completeInvocation(
        mockExecutionId,
        invocationId3,
        undefined,
      );
      expect(invocationTracker.hasActiveInvocation()).toBe(false); // All completed
    });

    it("should handle completing the same invocation multiple times", async () => {
      const invocationId = invocationTracker.createInvocation();
      expect(invocationTracker.hasActiveInvocation()).toBe(true);

      // Complete the same invocation multiple times
      await invocationTracker.completeInvocation(
        mockExecutionId,
        invocationId,
        undefined,
      );

      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });

    it("should handle completing non-existent invocations gracefully", async () => {
      const nonExistentId = createInvocationId("non-existent");

      const existingId = invocationTracker.createInvocation();
      expect(invocationTracker.hasActiveInvocation()).toBe(true);

      // Try to complete a non-existent invocation
      await expect(() =>
        invocationTracker.completeInvocation(
          mockExecutionId,
          nonExistentId,
          undefined,
        ),
      ).rejects.toThrow();

      // Existing invocation should still be active
      expect(invocationTracker.hasActiveInvocation()).toBe(true);

      // Complete the existing one
      await invocationTracker.completeInvocation(
        mockExecutionId,
        existingId,
        undefined,
      );
      expect(invocationTracker.hasActiveInvocation()).toBe(false);
    });
  });

  describe("reset with new completion tracking", () => {
    it("should clear completion tracking when reset", async () => {
      const invocationId1 = invocationTracker.createInvocation();
      invocationTracker.createInvocation();

      await invocationTracker.completeInvocation(
        mockExecutionId,
        invocationId1,
        undefined,
      );

      expect(invocationTracker.hasActiveInvocation()).toBe(true); // One still active

      // Reset should clear everything
      invocationTracker.reset();

      expect(invocationTracker.hasActiveInvocation()).toBe(false); // No invocations

      // After reset, creating new invocations should work normally
      invocationTracker.createInvocation();
      expect(invocationTracker.hasActiveInvocation()).toBe(true);
    });
  });
});
