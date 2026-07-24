/**
 * Cross-language DAG conformance suite (TypeScript).
 *
 * Implements every catalog scenario in `docs/DAG_CONFORMANCE.md` applicable to
 * TS (DAG-1 … DAG-19, incl. the [TS+Go] custom-completion DAG-18), executes it
 * via the shipped `feature/dag` API through `createTestDurableContext` (the same
 * driver the existing DAG tests use), asserts the live outcome equals the
 * catalog's expected semantic outcome, collects the language-neutral normalized
 * record (Part B), and emits all records — key-sorted, byte-diffable — to
 * `/Users/parpooya/workplace/dag-conformance-out/ts.json`.
 */
import * as fs from "fs";
import * as path from "path";
import { createTestDurableContext } from "../../testing/create-test-durable-context";
import { DagResultImpl } from "./dag-result";
import {
  DagResult,
  DagCompletionStatus,
  AnyTaskHandle,
  TriggerRule,
} from "../../types/dag";
import {
  CompletionOutcome,
  completeBatch,
  continueBatch,
} from "../../types/batch";
import {
  DagCyclicDependencyError,
  DagDuplicateTaskError,
  DagInvalidTaskNameError,
  DagInvalidDependencyError,
} from "../../errors/dag-errors/dag-errors";

// ─────────────────────────────────────────────────────────────────────────
// Normalized record model + harness helpers (inlined; test-only, never shipped)
// ─────────────────────────────────────────────────────────────────────────

type Ctx = ReturnType<typeof createTestDurableContext>["context"];

interface TaskRecord {
  status: "SUCCEEDED" | "FAILED" | "SKIPPED" | "STARTED";
  result: unknown | null;
  error_type: string | null;
  skip_reason: "TRIGGER_RULE" | "RUN_IF_PREDICATE" | null;
}
interface Counts {
  success: number;
  failure: number;
  skipped: number;
  total: number;
}
interface StructuralIdChecks {
  name_based: boolean;
  has_delimiter: boolean;
  dash_free: boolean;
  disjoint_from_counter: boolean;
}
interface ConformanceRecord {
  scenario: string;
  tasks: Record<string, TaskRecord>;
  completion_reason: string | null;
  counts: Counts;
  structural_id_checks: StructuralIdChecks;
  validation_error: string | null;
}

const NAME_CHARSET = /^[a-zA-Z0-9_]+$/;
const COUNTER_ID = /^(.+-)?\d+$/;
const DELIMITER = "DAG_NODE_T_";

const records: Record<string, ConformanceRecord> = {};

function normalizeResult(value: unknown): unknown {
  if (value instanceof DagResultImpl) {
    return {
      completion_reason: value.completionReason,
      counts: {
        success: value.successCount,
        failure: value.failureCount,
        skipped: value.skippedCount,
        total: value.totalCount,
      },
    };
  }
  return value;
}

function buildTasks(result: DagResult): Record<string, TaskRecord> {
  const tasks: Record<string, TaskRecord> = {};
  for (const exec of result.results.values()) {
    tasks[exec.name] = {
      status: exec.status,
      result:
        exec.status === "SUCCEEDED"
          ? (normalizeResult(exec.result) ?? null)
          : null,
      // Every failing body in this catalog is a `step` task → StepError.
      error_type: exec.status === "FAILED" ? "StepError" : null,
      skip_reason: exec.status === "SKIPPED" ? (exec.skipReason ?? null) : null,
    };
  }
  return tasks;
}

function structuralIdChecks(ctx: Ctx, taskNames: string[]): StructuralIdChecks {
  if (taskNames.length === 0) {
    return {
      name_based: true,
      has_delimiter: true,
      dash_free: true,
      disjoint_from_counter: true,
    };
  }
  const ids = taskNames.map((n) => ({ name: n, id: ctx.createTaskId(n) }));
  return {
    name_based: ids.every(
      ({ name, id }) =>
        id.endsWith(`${DELIMITER}${name}`) && !COUNTER_ID.test(id),
    ),
    has_delimiter: ids.every(({ id }) => id.split(DELIMITER).length - 1 === 1),
    dash_free: taskNames.every((n) => NAME_CHARSET.test(n)),
    disjoint_from_counter: ids.every(
      ({ id }) => id.includes(DELIMITER) && !COUNTER_ID.test(id),
    ),
  };
}

/** Builds the record for a non-validation scenario and stores it. */
function record(
  scenario: string,
  result: DagResult,
  ctx: Ctx,
  taskNames: string[],
): ConformanceRecord {
  const rec: ConformanceRecord = {
    scenario,
    tasks: buildTasks(result),
    completion_reason: result.completionReason,
    counts: {
      success: result.successCount,
      failure: result.failureCount,
      skipped: result.skippedCount,
      total: result.totalCount,
    },
    structural_id_checks: structuralIdChecks(ctx, taskNames),
    validation_error: null,
  };
  records[scenario] = rec;
  return rec;
}

/** Builds the record for a validation-error scenario (DAG-11..15) and stores it. */
function validationRecord(scenario: string, token: string): void {
  records[scenario] = {
    scenario,
    tasks: {},
    completion_reason: null,
    counts: { success: 0, failure: 0, skipped: 0, total: 0 },
    structural_id_checks: {
      name_based: false,
      has_delimiter: false,
      dash_free: false,
      disjoint_from_counter: false,
    },
    validation_error: token,
  };
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

const NO_RETRY = {
  retryStrategy: (): { shouldRetry: boolean } => ({ shouldRetry: false }),
};
const num = (v: unknown): number => v as number;

// ─────────────────────────────────────────────────────────────────────────
// Scenarios
// ─────────────────────────────────────────────────────────────────────────

describe("DAG cross-language conformance (TypeScript)", () => {
  it("DAG-1 diamond fan-out/in with typed deps", async () => {
    const { context } = createTestDurableContext();
    const result = await context.dag("dag1", (d) => {
      const fetch = d.step("fetch", [], async () => 10);
      const ta = d.step("ta", [fetch], async (deps) => num(deps.fetch) + 1);
      const tb = d.step("tb", [fetch], async (deps) => num(deps.fetch) * 2);
      d.step("merge", [ta, tb], async (deps) => num(deps.ta) + num(deps.tb));
    });
    expect(result.getResult("fetch")).toBe(10);
    expect(result.getResult("ta")).toBe(11);
    expect(result.getResult("tb")).toBe(20);
    expect(result.getResult("merge")).toBe(31);
    expect(result.completionReason).toBe("ALL_COMPLETED");
    expect([
      result.successCount,
      result.failureCount,
      result.skippedCount,
      result.totalCount,
    ]).toEqual([4, 0, 0, 4]);
    record("DAG-1", result, context, ["fetch", "ta", "tb", "merge"]);
  });

  it("DAG-2 compensation — charge FAILS", async () => {
    const { context } = createTestDurableContext();
    const result = await context.dag("dag2", (d) => {
      const charge = d.step(
        "charge",
        [],
        async () => {
          throw new Error("charge failed");
        },
        NO_RETRY,
      );
      d.step("fulfill", [], async () => "fulfilled").after(charge);
      d.step("refund", [], async () => "refunded")
        .after(charge)
        .triggerRule("ALL_FAILED");
      d.step("audit", [], async () => "audited")
        .after(charge)
        .triggerRule("ALL_DONE");
    });
    expect(result.getStatus("charge")).toBe("FAILED");
    expect(result.getStatus("fulfill")).toBe("SKIPPED");
    expect(result.skipped().find((e) => e.name === "fulfill")?.skipReason).toBe(
      "TRIGGER_RULE",
    );
    expect(result.getResult("refund")).toBe("refunded");
    expect(result.getResult("audit")).toBe("audited");
    expect(result.completionReason).toBe("COMPLETED_WITH_FAILURES");
    expect([
      result.successCount,
      result.failureCount,
      result.skippedCount,
      result.totalCount,
    ]).toEqual([2, 1, 1, 4]);
    record("DAG-2", result, context, ["charge", "fulfill", "refund", "audit"]);
  });

  it("DAG-3 compensation — charge SUCCEEDS", async () => {
    const { context } = createTestDurableContext();
    const result = await context.dag("dag3", (d) => {
      const charge = d.step("charge", [], async () => "charged");
      d.step("fulfill", [], async () => "fulfilled").after(charge);
      d.step("refund", [], async () => "refunded")
        .after(charge)
        .triggerRule("ALL_FAILED");
      d.step("audit", [], async () => "audited")
        .after(charge)
        .triggerRule("ALL_DONE");
    });
    expect(result.getResult("charge")).toBe("charged");
    expect(result.getResult("fulfill")).toBe("fulfilled");
    expect(result.getStatus("refund")).toBe("SKIPPED");
    expect(result.getResult("audit")).toBe("audited");
    expect(result.completionReason).toBe("ALL_COMPLETED");
    expect([
      result.successCount,
      result.failureCount,
      result.skippedCount,
      result.totalCount,
    ]).toEqual([3, 0, 1, 4]);
    record("DAG-3", result, context, ["charge", "fulfill", "refund", "audit"]);
  });

  it("DAG-4 runIf value-branching", async () => {
    const { context } = createTestDurableContext();
    const result = await context.dag("dag4", (d) => {
      const classify = d.step("classify", [], async () => "review");
      d.step("publish", [classify], async () => "published", {
        runIf: (deps) => deps.classify === "publish",
      });
      d.step("review", [classify], async () => "reviewed", {
        runIf: (deps) => deps.classify === "review",
      });
      d.step("block", [classify], async () => "blocked", {
        runIf: (deps) => deps.classify === "block",
      });
    });
    expect(result.getResult("classify")).toBe("review");
    expect(result.getStatus("publish")).toBe("SKIPPED");
    expect(result.getResult("review")).toBe("reviewed");
    expect(result.getStatus("block")).toBe("SKIPPED");
    expect(
      result.skipped().every((e) => e.skipReason === "RUN_IF_PREDICATE"),
    ).toBe(true);
    expect([
      result.successCount,
      result.failureCount,
      result.skippedCount,
      result.totalCount,
    ]).toEqual([2, 0, 2, 4]);
    record("DAG-4", result, context, [
      "classify",
      "publish",
      "review",
      "block",
    ]);
  });

  it("DAG-5 trigger matrix — empty-upstream row", async () => {
    const { context } = createTestDurableContext();
    const names = [
      "r_all_success",
      "r_all_failed",
      "r_all_done",
      "r_one_success",
      "r_one_failed",
      "r_none_failed",
    ] as const;
    const rules = {
      r_all_success: "ALL_SUCCESS",
      r_all_failed: "ALL_FAILED",
      r_all_done: "ALL_DONE",
      r_one_success: "ANY_SUCCESS",
      r_one_failed: "ANY_FAILED",
      r_none_failed: "NONE_FAILED",
    } as const;
    const result = await context.dag("dag5", (d) => {
      for (const n of names) {
        d.step(n, [], async () => "ok").triggerRule(rules[n]);
      }
    });
    expect(result.getStatus("r_all_success")).toBe("SUCCEEDED");
    expect(result.getStatus("r_all_failed")).toBe("SKIPPED");
    expect(result.getStatus("r_all_done")).toBe("SUCCEEDED");
    expect(result.getStatus("r_one_success")).toBe("SKIPPED");
    expect(result.getStatus("r_one_failed")).toBe("SKIPPED");
    expect(result.getStatus("r_none_failed")).toBe("SUCCEEDED");
    expect([
      result.successCount,
      result.failureCount,
      result.skippedCount,
      result.totalCount,
    ]).toEqual([3, 0, 3, 6]);
    expect(result.completionReason).toBe("ALL_COMPLETED");
    record("DAG-5", result, context, [...names]);
  });

  it("DAG-6 trigger matrix — mixed succ/fail upstream", async () => {
    const { context } = createTestDurableContext();
    const consumers = {
      c_all_success: "ALL_SUCCESS",
      c_all_failed: "ALL_FAILED",
      c_all_done: "ALL_DONE",
      c_one_success: "ANY_SUCCESS",
      c_one_failed: "ANY_FAILED",
      c_none_failed: "NONE_FAILED",
    } as const;
    const result = await context.dag("dag6", (d) => {
      const upOk = d.step("up_ok", [], async () => "ok");
      const upFail = d.step(
        "up_fail",
        [],
        async () => {
          throw new Error("fail");
        },
        NO_RETRY,
      );
      for (const [name, rule] of Object.entries(consumers)) {
        d.step(name, [], async () => "c")
          .after(upOk, upFail)
          .triggerRule(rule as TriggerRule);
      }
    });
    expect(result.getStatus("up_ok")).toBe("SUCCEEDED");
    expect(result.getStatus("up_fail")).toBe("FAILED");
    expect(result.getStatus("c_all_success")).toBe("SKIPPED");
    expect(result.getStatus("c_all_failed")).toBe("SKIPPED");
    expect(result.getResult("c_all_done")).toBe("c");
    expect(result.getResult("c_one_success")).toBe("c");
    expect(result.getResult("c_one_failed")).toBe("c");
    expect(result.getStatus("c_none_failed")).toBe("SKIPPED");
    expect([
      result.successCount,
      result.failureCount,
      result.skippedCount,
      result.totalCount,
    ]).toEqual([4, 1, 3, 8]);
    expect(result.completionReason).toBe("COMPLETED_WITH_FAILURES");
    record("DAG-6", result, context, [
      "up_ok",
      "up_fail",
      ...Object.keys(consumers),
    ]);
  });

  it("DAG-7 trigger matrix — all-failed upstream", async () => {
    const { context } = createTestDurableContext();
    const consumers = {
      k_all_success: "ALL_SUCCESS",
      k_all_failed: "ALL_FAILED",
      k_all_done: "ALL_DONE",
      k_one_success: "ANY_SUCCESS",
      k_one_failed: "ANY_FAILED",
      k_none_failed: "NONE_FAILED",
    } as const;
    const result = await context.dag("dag7", (d) => {
      const u1 = d.step(
        "u1",
        [],
        async () => {
          throw new Error("fail");
        },
        NO_RETRY,
      );
      const u2 = d.step(
        "u2",
        [],
        async () => {
          throw new Error("fail");
        },
        NO_RETRY,
      );
      for (const [name, rule] of Object.entries(consumers)) {
        d.step(name, [], async () => "k")
          .after(u1, u2)
          .triggerRule(rule as TriggerRule);
      }
    });
    expect(result.getStatus("u1")).toBe("FAILED");
    expect(result.getStatus("u2")).toBe("FAILED");
    expect(result.getStatus("k_all_success")).toBe("SKIPPED");
    expect(result.getResult("k_all_failed")).toBe("k");
    expect(result.getResult("k_all_done")).toBe("k");
    expect(result.getStatus("k_one_success")).toBe("SKIPPED");
    expect(result.getResult("k_one_failed")).toBe("k");
    expect(result.getStatus("k_none_failed")).toBe("SKIPPED");
    expect([
      result.successCount,
      result.failureCount,
      result.skippedCount,
      result.totalCount,
    ]).toEqual([3, 2, 3, 8]);
    expect(result.completionReason).toBe("COMPLETED_WITH_FAILURES");
    record("DAG-7", result, context, ["u1", "u2", ...Object.keys(consumers)]);
  });

  it("DAG-8 skip cascade", async () => {
    const { context } = createTestDurableContext();
    const result = await context.dag("dag8", (d) => {
      const seed = d.step("seed", [], async () => 1);
      const gate = d.step("gate", [seed], async () => "gate", {
        runIf: (deps) => num(deps.seed) > 100,
      });
      const d1 = d.step("d1", [gate], async () => "d1");
      d.step("d2", [d1], async () => "d2");
      d.step("sink", [], async () => "sink")
        .after(gate)
        .triggerRule("ALL_DONE");
    });
    expect(result.getResult("seed")).toBe(1);
    expect(result.getStatus("gate")).toBe("SKIPPED");
    expect(result.skipped().find((e) => e.name === "gate")?.skipReason).toBe(
      "RUN_IF_PREDICATE",
    );
    expect(result.getStatus("d1")).toBe("SKIPPED");
    expect(result.getStatus("d2")).toBe("SKIPPED");
    expect(result.getResult("sink")).toBe("sink");
    expect([
      result.successCount,
      result.failureCount,
      result.skippedCount,
      result.totalCount,
    ]).toEqual([2, 0, 3, 5]);
    expect(result.completionReason).toBe("ALL_COMPLETED");
    record("DAG-8", result, context, ["seed", "gate", "d1", "d2", "sink"]);
  });

  it("DAG-9 nested DAG + scope isolation", async () => {
    const { context } = createTestDurableContext();
    const result = await context.dag("dag9", (d) => {
      const a = d.step("a", [], async () => 2);
      const inner = d.dag("inner", [a], (sub) => {
        const x = sub.step("x", [], async () => 3);
        sub.step("y", [x], async (deps) => num(deps.x) * 10);
      });
      d.step("consume", [inner], async (deps) => {
        const innerResult = deps.inner as DagResult;
        return num(innerResult.getResult("y")) + 5;
      });
    });
    expect(result.getResult("a")).toBe(2);
    expect(result.getStatus("inner")).toBe("SUCCEEDED");
    const innerResult = result.getResult("inner") as DagResult;
    expect(innerResult.getResult("x")).toBe(3);
    expect(innerResult.getResult("y")).toBe(30);
    expect(innerResult.completionReason).toBe("ALL_COMPLETED");
    expect([
      innerResult.successCount,
      innerResult.failureCount,
      innerResult.skippedCount,
      innerResult.totalCount,
    ]).toEqual([2, 0, 0, 2]);
    expect(result.getResult("consume")).toBe(35);
    // Scope isolation: inner task names are invisible in the outer scope.
    expect(result.getStatus("x")).toBeUndefined();
    expect(result.getStatus("y")).toBeUndefined();
    expect([
      result.successCount,
      result.failureCount,
      result.skippedCount,
      result.totalCount,
    ]).toEqual([3, 0, 0, 3]);
    record("DAG-9", result, context, ["a", "inner", "consume"]);
  });

  it("DAG-10 empty DAG", async () => {
    const { context } = createTestDurableContext();
    const result = await context.dag("dag10", () => {});
    expect(result.totalCount).toBe(0);
    expect(result.completionReason).toBe("ALL_COMPLETED");
    expect(result.results.size).toBe(0);
    record("DAG-10", result, context, []);
  });

  it("DAG-11 validation — cycle", async () => {
    const { context } = createTestDurableContext();
    await expect(
      context.dag("dag11", (d) => {
        const p = d.step("p", [], async () => 1);
        const q = d.step("q", [p], async () => 2);
        p.after(q);
      }),
    ).rejects.toBeInstanceOf(DagCyclicDependencyError);
    validationRecord("DAG-11", "DagCyclicDependencyError");
  });

  it("DAG-12 validation — duplicate name", async () => {
    const { context } = createTestDurableContext();
    await expect(
      context.dag("dag12", (d) => {
        d.step("dup", [], async () => 1);
        d.step("dup", [], async () => 2);
      }),
    ).rejects.toBeInstanceOf(DagDuplicateTaskError);
    validationRecord("DAG-12", "DagDuplicateTaskError");
  });

  it("DAG-13 validation — invalid name (dash)", async () => {
    const { context } = createTestDurableContext();
    await expect(
      context.dag("dag13", (d) => {
        d.step("fetch-data", [], async () => 1);
      }),
    ).rejects.toBeInstanceOf(DagInvalidTaskNameError);
    validationRecord("DAG-13", "DagInvalidTaskNameError");
  });

  it("DAG-14 validation — invalid name (reserved token)", async () => {
    const { context } = createTestDurableContext();
    await expect(
      context.dag("dag14", (d) => {
        d.step("DAG_NODE_T_root", [], async () => 1);
      }),
    ).rejects.toBeInstanceOf(DagInvalidTaskNameError);
    validationRecord("DAG-14", "DagInvalidTaskNameError");
  });

  it("DAG-15 validation — missing/foreign-scope dependency", async () => {
    const { context } = createTestDurableContext();
    // Capture a handle minted in a *different* DAG scope.
    let foreign!: AnyTaskHandle;
    await context.dag("dag15_sibling", (d) => {
      foreign = d.step("foreign", [], async () => 1);
    });
    await expect(
      context.dag("dag15", (d) => {
        d.step("t", [foreign], async () => 1);
      }),
    ).rejects.toBeInstanceOf(DagInvalidDependencyError);
    validationRecord("DAG-15", "DagInvalidDependencyError");
  });

  it("DAG-16 early completion — minSuccessful", async () => {
    const { context } = createTestDurableContext();
    const result = await context.dag(
      "dag16",
      (d) => {
        const s1 = d.step("s1", [], async () => 1);
        const s2 = d.step("s2", [s1], async () => 2);
        const s3 = d.step("s3", [s2], async () => 3);
        const s4 = d.step("s4", [s3], async () => 4);
        d.step("s5", [s4], async () => 5);
      },
      { maxConcurrency: 1, completionConfig: { minSuccessful: 3 } },
    );
    expect(result.getResult("s1")).toBe(1);
    expect(result.getResult("s2")).toBe(2);
    expect(result.getResult("s3")).toBe(3);
    expect(result.getStatus("s4")).toBeUndefined();
    expect(result.getStatus("s5")).toBeUndefined();
    expect(result.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
    expect([
      result.successCount,
      result.failureCount,
      result.skippedCount,
      result.totalCount,
    ]).toEqual([3, 0, 0, 5]);
    // Only the tasks that ran get ids; absent tasks minted none.
    record("DAG-16", result, context, ["s1", "s2", "s3"]);
  });

  it("DAG-17 early completion — toleratedFailureCount exceeded", async () => {
    const { context } = createTestDurableContext();
    const throwing = async (): Promise<never> => {
      throw new Error("boom");
    };
    const result = await context.dag(
      "dag17",
      (d) => {
        const t1 = d.step("t1", [], throwing, NO_RETRY);
        const t2 = d
          .step("t2", [t1], throwing, NO_RETRY)
          .triggerRule("ALL_DONE");
        const t3 = d
          .step("t3", [t2], throwing, NO_RETRY)
          .triggerRule("ALL_DONE");
        d.step("t4", [t3], throwing, NO_RETRY).triggerRule("ALL_DONE");
      },
      { maxConcurrency: 1, completionConfig: { toleratedFailureCount: 1 } },
    );
    expect(result.getStatus("t1")).toBe("FAILED");
    expect(result.getStatus("t2")).toBe("FAILED");
    expect(result.getStatus("t3")).toBeUndefined();
    expect(result.getStatus("t4")).toBeUndefined();
    expect(result.completionReason).toBe("FAILURE_TOLERANCE_EXCEEDED");
    expect([
      result.successCount,
      result.failureCount,
      result.skippedCount,
      result.totalCount,
    ]).toEqual([0, 2, 0, 4]);
    record("DAG-17", result, context, ["t1", "t2"]);
  });

  it("DAG-18 custom result-based completion [TS+Go]", async () => {
    const { context } = createTestDurableContext();
    const result = await context.dag(
      "dag18",
      (d) => {
        const r1 = d.step("r1", [], async () => ({ verdict: "ACCEPT" }));
        const r2 = d.step("r2", [r1], async () => ({ verdict: "REJECT" }));
        d.step("r3", [r2], async () => ({ verdict: "ACCEPT" }));
      },
      {
        maxConcurrency: 1,
        completionConfig: {
          shouldComplete: (status: DagCompletionStatus) => {
            const rejected = status.items.some(
              (i) =>
                i.status === "SUCCEEDED" &&
                (i.result as { verdict?: string } | undefined)?.verdict ===
                  "REJECT",
            );
            return rejected
              ? completeBatch(CompletionOutcome.FAILED)
              : continueBatch();
          },
        },
      },
    );
    expect(result.getResult("r1")).toEqual({ verdict: "ACCEPT" });
    expect(result.getResult("r2")).toEqual({ verdict: "REJECT" });
    expect(result.getStatus("r3")).toBeUndefined();
    expect(result.completionReason).toBe("CUSTOM_COMPLETION_FAILED");
    expect([
      result.successCount,
      result.failureCount,
      result.skippedCount,
      result.totalCount,
    ]).toEqual([2, 0, 0, 3]);
    expect(() => result.throwIfError()).toThrow();
    record("DAG-18", result, context, ["r1", "r2"]);
  });

  it("DAG-19 order-independence (identical record under swapped completion order)", async () => {
    // Run 1: natural order (b before c). Run 2: reversed registration (c before b).
    const build = async (
      order: "bc" | "cb",
    ): Promise<{ context: Ctx; result: DagResult }> => {
      const { context } = createTestDurableContext();
      const result = await context.dag("dag19", (d) => {
        const root = d.step("root", [], async () => 100);
        let b, c;
        if (order === "bc") {
          b = d.step("b", [root], async (deps) => num(deps.root) + 1);
          c = d.step("c", [root], async (deps) => num(deps.root) + 2);
        } else {
          c = d.step("c", [root], async (deps) => num(deps.root) + 2);
          b = d.step("b", [root], async (deps) => num(deps.root) + 1);
        }
        d.step("merge", [b, c], async (deps) => num(deps.b) + num(deps.c));
      });
      return { context, result };
    };

    const first = await build("bc");
    const second = await build("cb");

    for (const { result } of [first, second]) {
      expect(result.getResult("root")).toBe(100);
      expect(result.getResult("b")).toBe(101);
      expect(result.getResult("c")).toBe(102);
      expect(result.getResult("merge")).toBe(203);
      expect(result.completionReason).toBe("ALL_COMPLETED");
      expect([
        result.successCount,
        result.failureCount,
        result.skippedCount,
        result.totalCount,
      ]).toEqual([4, 0, 0, 4]);
    }

    const names = ["root", "b", "c", "merge"];
    const recFirst = record("DAG-19", first.result, first.context, names);
    // The reversed-order run MUST produce a byte-identical record.
    const recSecondJson = JSON.stringify(
      sortDeep({
        ...recFirst,
        tasks: buildTasks(second.result),
        counts: {
          success: second.result.successCount,
          failure: second.result.failureCount,
          skipped: second.result.skippedCount,
          total: second.result.totalCount,
        },
        structural_id_checks: structuralIdChecks(second.context, names),
      }),
    );
    expect(recSecondJson).toEqual(JSON.stringify(sortDeep(recFirst)));
  });

  it("emits the normalized, key-sorted ts.json envelope", () => {
    // All 19 TS-applicable scenarios must have produced a record.
    expect(Object.keys(records).sort()).toEqual(
      [
        "DAG-1",
        "DAG-2",
        "DAG-3",
        "DAG-4",
        "DAG-5",
        "DAG-6",
        "DAG-7",
        "DAG-8",
        "DAG-9",
        "DAG-10",
        "DAG-11",
        "DAG-12",
        "DAG-13",
        "DAG-14",
        "DAG-15",
        "DAG-16",
        "DAG-17",
        "DAG-18",
        "DAG-19",
      ].sort(),
    );

    const outDir = "/Users/parpooya/workplace/dag-conformance-out";
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "ts.json");
    const serialized = JSON.stringify(sortDeep(records), null, 2) + "\n";
    fs.writeFileSync(outPath, serialized, "utf8");

    // Byte-diffability guarantees: trailing newline, 2-space indent, sorted keys.
    const readBack = fs.readFileSync(outPath, "utf8");
    expect(readBack.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(readBack) as Record<string, unknown>;
    expect(Object.keys(parsed).length).toBe(19);
    // Top-level keys are lexicographically sorted.
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
    // Every non-validation record's structural checks are all true.
    for (const [id, rec] of Object.entries(records)) {
      const isValidation = rec.validation_error !== null;
      const s = rec.structural_id_checks;
      const allTrue =
        s.name_based &&
        s.has_delimiter &&
        s.dash_free &&
        s.disjoint_from_counter;
      if (isValidation) {
        expect(allTrue).toBe(false);
        expect(rec.completion_reason).toBeNull();
        expect(Object.keys(rec.tasks).length).toBe(0);
      } else {
        expect(allTrue).toBe(true);
      }
      expect(id).toBe(rec.scenario);
    }
  });
});
