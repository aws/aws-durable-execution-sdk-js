import { createTestDurableContext } from "../../testing/create-test-durable-context";
import {
  DagCyclicDependencyError,
  DagDuplicateTaskError,
} from "../../errors/dag-errors/dag-errors";

describe("context.dag() composed integration", () => {
  it("runs a diamond and merges dependency results", async () => {
    const { context } = createTestDurableContext();
    const result = await context.dag("etl", (d) => {
      const fetch = d.step("fetch", [], async () => 10);
      const a = d.step(
        "a",
        [fetch],
        async (deps) => (deps.fetch as number) + 1,
      );
      const b = d.step(
        "b",
        [fetch],
        async (deps) => (deps.fetch as number) + 2,
      );
      d.step(
        "merge",
        [a, b],
        async (deps) => (deps.a as number) + (deps.b as number),
      );
    });
    expect(result.getStatus("fetch")).toBe("SUCCEEDED");
    expect(result.getStatus("a")).toBe("SUCCEEDED");
    expect(result.getStatus("b")).toBe("SUCCEEDED");
    expect(result.getResult("merge")).toBe(11 + 12);
    expect(result.completionReason).toBe("ALL_COMPLETED");
    expect(result.successCount).toBe(4);
  });

  it("runs compensation with trigger rules on failure", async () => {
    const { context } = createTestDurableContext();
    const result = await context.dag("payment", (d) => {
      const charge = d.step(
        "charge",
        [],
        async () => {
          throw new Error("declined");
        },
        { retryStrategy: () => ({ shouldRetry: false }) },
      );
      d.step("fulfill", [charge], async () => "fulfilled");
      d.step("refund", [], async () => "refunded")
        .after(charge)
        .triggerRule("ALL_FAILED");
      d.step("audit", [], async () => "audited")
        .after(charge)
        .triggerRule("ALL_DONE");
    });
    expect(result.completionReason).toBe("COMPLETED_WITH_FAILURES");
    expect(result.getStatus("charge")).toBe("FAILED");
    expect(result.getStatus("fulfill")).toBe("SKIPPED");
    expect(result.getResult("refund")).toBe("refunded");
    expect(result.getResult("audit")).toBe("audited");
    expect(() => result.throwIfError()).toThrow();
  });

  it("passes a FAILED dependency's result as undefined into a downstream task (deps value is R | undefined at runtime)", async () => {
    const { context } = createTestDurableContext();
    // Captured from inside the task body to prove the executor actually handed
    // `undefined` to the running task (not just that the result type allows it).
    let observedChargeUndefined: boolean | undefined;
    const result = await context.dag("payment-nullability", (d) => {
      // `charge` declares a `number` result but fails at runtime.
      const charge = d.step(
        "charge",
        [],
        async (): Promise<number> => {
          throw new Error("declined");
        },
        { retryStrategy: () => ({ shouldRetry: false }) },
      );
      // `audit` depends on `charge` (so `deps.charge` is in its deps map, typed
      // `number | undefined`) and runs under ALL_DONE, so it executes even
      // though `charge` FAILED. At runtime the failed dependency's result is
      // absent — `deps.charge` is `undefined` — which is exactly what the
      // `R | undefined` type on `DepsMap` encodes.
      d.step("audit", [charge], async (deps): Promise<boolean> => {
        observedChargeUndefined = deps.charge === undefined;
        return observedChargeUndefined;
      }).triggerRule("ALL_DONE");
    });

    expect(result.getStatus("charge")).toBe("FAILED");
    expect(result.getStatus("audit")).toBe("SUCCEEDED");
    // The audit body observed the failed dependency's result as `undefined`.
    expect(observedChargeUndefined).toBe(true);
    expect(result.getResult("audit")).toBe(true);
    expect(result.completionReason).toBe("COMPLETED_WITH_FAILURES");
  });

  it("branches with runIf, skipping non-matching tasks", async () => {
    const { context } = createTestDurableContext();
    const result = await context.dag("moderation", (d) => {
      const classify = d.step("classify", [], async () => "safe");
      d.step("publish", [classify], async () => "published", {
        runIf: (deps) => deps.classify === "safe",
      });
      d.step("review", [classify], async () => "reviewed", {
        runIf: (deps) => deps.classify === "review",
      });
      d.step("blocked", [classify], async () => "blocked", {
        runIf: (deps) => deps.classify === "block",
      });
    });
    expect(result.getResult("publish")).toBe("published");
    expect(result.getStatus("review")).toBe("SKIPPED");
    expect(result.getStatus("blocked")).toBe("SKIPPED");
    expect(
      result.skipped().every((e) => e.skipReason === "RUN_IF_PREDICATE"),
    ).toBe(true);
  });

  it("supports nested DAGs consumed downstream", async () => {
    const { context } = createTestDurableContext();
    const result = await context.dag("outer", (d) => {
      const inner = d.dag("inner", [], (sub) => {
        const x = sub.step("x", [], async () => 5);
        sub.step("y", [x], async (deps) => (deps.x as number) * 2);
      });
      d.step("consume", [inner], async (deps) => {
        const innerResult = deps.inner as {
          getResult(name: string): unknown;
        };
        return innerResult.getResult("y");
      });
    });
    expect(result.getStatus("inner")).toBe("SUCCEEDED");
    expect(result.getResult("consume")).toBe(10);
  });

  it("surfaces graph-shape errors unwrapped (cycle)", async () => {
    const { context } = createTestDurableContext();
    await expect(
      context.dag("cyclic", (d) => {
        const a = d.step("a", [], async () => 1);
        const b = d.step("b", [a], async () => 2);
        // Introduce a cycle via ordering-only builder dep.
        a.after(b);
      }),
    ).rejects.toBeInstanceOf(DagCyclicDependencyError);
  });

  it("surfaces duplicate-name errors unwrapped", async () => {
    const { context } = createTestDurableContext();
    await expect(
      context.dag("dup", (d) => {
        d.step("same", [], async () => 1);
        d.step("same", [], async () => 2);
      }),
    ).rejects.toBeInstanceOf(DagDuplicateTaskError);
  });

  it("resolves an empty DAG", async () => {
    const { context } = createTestDurableContext();
    const result = await context.dag("empty", () => {});
    expect(result.totalCount).toBe(0);
    expect(result.completionReason).toBe("ALL_COMPLETED");
  });
});
