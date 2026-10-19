import {
  getActiveContext,
  runWithContext,
  runWithRootContext,
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

  describe("execution identity", () => {
    const identity = {
      executionArn: "arn:execution-1",
      requestId: "request-1",
      tenantId: "tenant-1",
    };

    it("records the identity on the root context", () => {
      runWithRootContext(identity, () => {
        expect(getActiveContext()).toEqual({
          contextId: "root",
          execution: identity,
        });
      });
    });

    it("keeps the identity in nested contexts", () => {
      runWithRootContext(identity, () => {
        runWithContext("step-1", "root", () => {
          runWithContext("step-1-1", "step-1", () => {
            expect(getActiveContext()?.execution).toBe(identity);
          });
        });
      });
    });

    it("keeps the identity across an await in a nested context", async () => {
      await runWithRootContext(identity, async () => {
        await runWithContext("step-1", "root", async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          expect(getActiveContext()?.execution).toBe(identity);
        });
      });
    });

    it("keeps each execution's identity when two executions interleave", async () => {
      const other = { executionArn: "arn:execution-2", requestId: "request-2" };
      const seen: string[] = [];
      const run = (id: typeof identity | typeof other, pause: number) =>
        runWithRootContext(id, () =>
          runWithContext("step-1", "root", async () => {
            await new Promise((resolve) => setTimeout(resolve, pause));
            seen.push(getActiveContext()?.execution?.executionArn ?? "none");
          }),
        );

      await Promise.all([run(identity, 10), run(other, 1)]);

      expect(seen).toEqual(["arn:execution-2", "arn:execution-1"]);
    });

    it("has no identity outside a root context", () => {
      runWithContext("context-1", undefined, () => {
        expect(getActiveContext()?.execution).toBeUndefined();
      });
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
