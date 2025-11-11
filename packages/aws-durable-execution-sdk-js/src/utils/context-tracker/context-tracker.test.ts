import {
  getActiveContext,
  runWithContext,
  validateContextUsage,
} from "./context-tracker";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";

describe("context-tracker", () => {
  describe("getActiveContext", () => {
    it("should return undefined when no context is active", () => {
      expect(getActiveContext()).toBeUndefined();
    });

    it("should return active context when set", () => {
      runWithContext("context-1", undefined, () => {
        expect(getActiveContext()).toEqual({
          contextId: "context-1",
          parentId: undefined,
        });
      });
    });
  });

  describe("runWithContext", () => {
    it("should execute function with context", () => {
      const result = runWithContext("context-1", undefined, () => {
        expect(getActiveContext()).toEqual({
          contextId: "context-1",
          parentId: undefined,
        });
        return "success";
      });
      expect(result).toBe("success");
    });

    it("should restore previous context after execution", () => {
      runWithContext("outer", undefined, () => {
        const outerContext = getActiveContext();
        runWithContext("inner", "outer", () => {
          expect(getActiveContext()?.contextId).toBe("inner");
        });
        expect(getActiveContext()).toEqual(outerContext);
      });
    });

    it("should handle async functions", async () => {
      const result = await runWithContext(
        "async-context",
        undefined,
        async () => {
          await Promise.resolve();
          expect(getActiveContext()?.contextId).toBe("async-context");
          return "async-success";
        },
      );
      expect(result).toBe("async-success");
    });
  });

  describe("validateContextUsage", () => {
    let terminationManager: TerminationManager;

    beforeEach(() => {
      terminationManager = new TerminationManager();
    });

    it("should not terminate when no active context", () => {
      const terminateSpy = jest.spyOn(terminationManager, "terminate");
      validateContextUsage("any-id", "test-op", terminationManager);
      expect(terminateSpy).not.toHaveBeenCalled();
    });

    it("should not terminate when context matches", () => {
      const terminateSpy = jest.spyOn(terminationManager, "terminate");
      runWithContext("context-1", undefined, () => {
        validateContextUsage("context-1", "test-op", terminationManager);
      });
      expect(terminateSpy).not.toHaveBeenCalled();
    });

    it("should terminate when context does not match", () => {
      const terminateSpy = jest.spyOn(terminationManager, "terminate");
      runWithContext("child-context", undefined, () => {
        validateContextUsage("parent-context", "test-op", terminationManager);
      });
      expect(terminateSpy).toHaveBeenCalledWith({
        reason: TerminationReason.CONTEXT_VALIDATION_ERROR,
        message: expect.stringContaining("Context usage error"),
        error: expect.any(Error),
      });
    });

    it("should include helpful error message", () => {
      const terminateSpy = jest.spyOn(terminationManager, "terminate");
      runWithContext("child-1", undefined, () => {
        validateContextUsage("parent", "runInChildContext", terminationManager);
      });
      expect(terminateSpy).toHaveBeenCalledWith({
        reason: TerminationReason.CONTEXT_VALIDATION_ERROR,
        message: expect.stringContaining("Context usage error"),
        error: expect.any(Error),
      });
    });
  });
});
