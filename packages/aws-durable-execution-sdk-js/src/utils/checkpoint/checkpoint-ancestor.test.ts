import { OperationAction } from "@aws-sdk/client-lambda";
import { CheckpointManager } from "./checkpoint-manager";
import { createTestCheckpointManager } from "../../testing/create-test-checkpoint-manager";
import { createMockExecutionContext } from "../../testing/mock-context";
import { EventEmitter } from "events";
import { createDefaultLogger } from "../logger/default-logger";
import { OperationLifecycleState } from "../../types/operation-lifecycle-state";
import { OperationSubType } from "../../types/core";

describe("CheckpointManager - Ancestor Functionality", () => {
  let checkpointManager: CheckpointManager;
  let mockContext: any;

  beforeEach(() => {
    mockContext = createMockExecutionContext();
    const emitter = new EventEmitter();
    const logger = createDefaultLogger();
    checkpointManager = createTestCheckpointManager(
      mockContext,
      "test-token",
      emitter,
      logger,
    );
  });

  describe("markAncestorFinished", () => {
    it("should add stepId to finished ancestors set", () => {
      checkpointManager.markAncestorFinished("1-2");
      checkpointManager.markAncestorFinished("1-3-1");

      // Access private field for testing
      const finishedAncestors = (checkpointManager as any).finishedAncestors;
      expect(finishedAncestors.has("1-2")).toBe(true);
      expect(finishedAncestors.has("1-3-1")).toBe(true);
    });

    it("should handle duplicate stepIds", () => {
      checkpointManager.markAncestorFinished("1-2");
      checkpointManager.markAncestorFinished("1-2");

      const finishedAncestors = (checkpointManager as any).finishedAncestors;
      expect(finishedAncestors.size).toBe(1);
      expect(finishedAncestors.has("1-2")).toBe(true);
    });
  });

  describe("hasFinishedAncestor", () => {
    it("should return false when no ancestors are finished", () => {
      const hasFinished = (checkpointManager as any).hasFinishedAncestor(
        "1-2-3",
      );
      expect(hasFinished).toBe(false);
    });

    it("should return true when direct parent is finished", () => {
      checkpointManager.markAncestorFinished("1-2");

      const hasFinished = (checkpointManager as any).hasFinishedAncestor(
        "1-2-3",
      );
      expect(hasFinished).toBe(true);
    });

    it("should return true when grandparent is finished", () => {
      checkpointManager.markAncestorFinished("1");

      const hasFinished = (checkpointManager as any).hasFinishedAncestor(
        "1-2-3",
      );
      expect(hasFinished).toBe(true);
    });

    it("should return true when any ancestor in chain is finished", () => {
      checkpointManager.markAncestorFinished("1-2-3");

      const hasFinished = (checkpointManager as any).hasFinishedAncestor(
        "1-2-3-4-5",
      );
      expect(hasFinished).toBe(true);
    });

    it("should return false when only sibling is finished", () => {
      checkpointManager.markAncestorFinished("1-3");

      const hasFinished = (checkpointManager as any).hasFinishedAncestor(
        "1-2-1",
      );
      expect(hasFinished).toBe(false);
    });

    it("should handle root level stepIds", () => {
      const hasFinished = (checkpointManager as any).hasFinishedAncestor("1");
      expect(hasFinished).toBe(false);
    });
  });

  describe("ancestor cleanup during termination", () => {
    it("should clean up operations with finished ancestors during termination", () => {
      // Create operations first (before marking ancestors as finished)
      checkpointManager.markOperationState(
        "1-2-3",
        OperationLifecycleState.RETRY_WAITING,
        {
          metadata: {
            stepId: "1-2-3",
            name: "test-step",
            type: "STEP",
            subType: OperationSubType.STEP,
            parentId: "1-2",
          },
        },
      );

      checkpointManager.markOperationState(
        "1-2-4",
        OperationLifecycleState.IDLE_AWAITED,
        {
          metadata: {
            stepId: "1-2-4",
            name: "test-step-2",
            type: "STEP",
            subType: OperationSubType.STEP,
            parentId: "1-2",
          },
        },
      );

      // Create operation without finished ancestor (should not be cleaned up)
      checkpointManager.markOperationState(
        "1-3-1",
        OperationLifecycleState.RETRY_WAITING,
        {
          metadata: {
            stepId: "1-3-1",
            name: "test-step-3",
            type: "STEP",
            subType: OperationSubType.STEP,
            parentId: "1-3",
          },
        },
      );

      // Verify operations exist before cleanup
      expect(checkpointManager.getOperationState("1-2-3")).toBe(
        OperationLifecycleState.RETRY_WAITING,
      );
      expect(checkpointManager.getOperationState("1-2-4")).toBe(
        OperationLifecycleState.IDLE_AWAITED,
      );
      expect(checkpointManager.getOperationState("1-3-1")).toBe(
        OperationLifecycleState.RETRY_WAITING,
      );

      // Now mark ancestor as finished
      checkpointManager.markAncestorFinished("1-2");

      // Trigger termination logic that includes ancestor cleanup
      (checkpointManager as any).checkAndTerminate();

      // Operations with finished ancestors should be cleaned up
      expect(checkpointManager.getOperationState("1-2-3")).toBeUndefined();
      expect(checkpointManager.getOperationState("1-2-4")).toBeUndefined();

      // Operation without finished ancestor should remain
      expect(checkpointManager.getOperationState("1-3-1")).toBe(
        OperationLifecycleState.RETRY_WAITING,
      );
    });

    it("should not clean up operations in EXECUTING state even with finished ancestors", () => {
      // Create operation first
      checkpointManager.markOperationState(
        "1-2-3",
        OperationLifecycleState.EXECUTING,
        {
          metadata: {
            stepId: "1-2-3",
            name: "test-step",
            type: "STEP",
            subType: OperationSubType.STEP,
            parentId: "1-2",
          },
        },
      );

      // Then mark ancestor as finished
      checkpointManager.markAncestorFinished("1-2");

      (checkpointManager as any).checkAndTerminate();

      // EXECUTING operation should not be cleaned up
      expect(checkpointManager.getOperationState("1-2-3")).toBe(
        OperationLifecycleState.EXECUTING,
      );
    });
  });

  describe("checkpoint with finished ancestors", () => {
    it("should skip checkpoint when ancestor is finished", async () => {
      checkpointManager.markAncestorFinished("1-2");

      const checkpointPromise = checkpointManager.checkpoint("1-2-3", {
        Action: OperationAction.START,
      });

      // Promise should never resolve when ancestor is finished
      let resolved = false;
      checkpointPromise.then(() => {
        resolved = true;
      });

      // Wait a bit to ensure promise doesn't resolve
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(resolved).toBe(false);
    });

    it("should not skip checkpoint when no ancestors are finished", () => {
      // Test the hasFinishedAncestor logic directly
      const hasFinished = (checkpointManager as any).hasFinishedAncestor(
        "1-2-3",
      );
      expect(hasFinished).toBe(false);
    });

    it("should not skip checkpoint when only siblings are finished", () => {
      checkpointManager.markAncestorFinished("1-3");

      // Test the hasFinishedAncestor logic directly
      const hasFinished = (checkpointManager as any).hasFinishedAncestor(
        "1-2-1",
      );
      expect(hasFinished).toBe(false);
    });
  });

  describe("integration with hierarchical stepIds", () => {
    it("should handle complex nested hierarchies", () => {
      checkpointManager.markAncestorFinished("1-2-3");

      expect(
        (checkpointManager as any).hasFinishedAncestor("1-2-3-4-5-6"),
      ).toBe(true);
      expect((checkpointManager as any).hasFinishedAncestor("1-2-4-1")).toBe(
        false,
      );
      expect((checkpointManager as any).hasFinishedAncestor("1-3-1")).toBe(
        false,
      );
    });

    it("should handle multiple finished ancestors", () => {
      checkpointManager.markAncestorFinished("1");
      checkpointManager.markAncestorFinished("1-2");
      checkpointManager.markAncestorFinished("1-2-3");

      // Should return true for any of the finished ancestors
      expect((checkpointManager as any).hasFinishedAncestor("1-2-3-4")).toBe(
        true,
      );
    });
  });
});
