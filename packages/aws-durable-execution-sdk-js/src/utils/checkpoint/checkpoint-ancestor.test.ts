import { OperationAction } from "@aws-sdk/client-lambda";
import { CheckpointManager } from "./checkpoint-manager";
import { createTestCheckpointManager } from "../../testing/create-test-checkpoint-manager";
import { createMockExecutionContext } from "../../testing/mock-context";
import { EventEmitter } from "events";
import { createDefaultLogger } from "../logger/default-logger";

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
