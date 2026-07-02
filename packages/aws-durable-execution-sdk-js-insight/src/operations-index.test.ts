import {
  buildOperationsByName,
  withOperationsByName,
} from "./operations-index";
import type { OperationRecord, WorkflowInsightRecord } from "./types";

function op(
  partial: Partial<OperationRecord> & { id: string },
): OperationRecord {
  return { type: "STEP", status: "SUCCEEDED", ...partial } as OperationRecord;
}

describe("buildOperationsByName", () => {
  it("aggregates metrics across occurrences and drops result/error for repeated names", () => {
    const byName = buildOperationsByName([
      op({
        id: "o1",
        name: "charge",
        subType: "Step",
        status: "FAILED",
        durationMs: 100,
        attempt: 1,
        error: { name: "StepError", message: "e1" },
      }),
      op({
        id: "o2",
        name: "charge",
        subType: "Step",
        status: "SUCCEEDED",
        durationMs: 210,
        attempt: 2,
        result: { ok: true },
      }),
    ]);

    expect(byName.charge).toEqual({
      type: "STEP",
      subType: "Step",
      count: 2,
      minDurationMs: 100,
      maxDurationMs: 210,
      totalDurationMs: 310,
      failedCount: 1,
      maxAttempt: 2,
      status: "SUCCEEDED", // most recently seen occurrence
      // no result/error: the name repeated
    });
    expect(byName.charge.result).toBeUndefined();
    expect(byName.charge.error).toBeUndefined();
  });

  it("keeps result for a single-occurrence operation", () => {
    const byName = buildOperationsByName([
      op({
        id: "o1",
        name: "insert",
        status: "SUCCEEDED",
        durationMs: 6200,
        result: { rows: 3 },
      }),
    ]);
    expect(byName.insert).toEqual({
      type: "STEP",
      count: 1,
      minDurationMs: 6200,
      maxDurationMs: 6200,
      totalDurationMs: 6200,
      failedCount: 0,
      status: "SUCCEEDED",
      result: { rows: 3 },
    });
  });

  it("keeps error for a single failed occurrence", () => {
    const byName = buildOperationsByName([
      op({
        id: "o1",
        name: "convert",
        status: "FAILED",
        error: { name: "StepError", message: "boom" },
      }),
    ]);
    expect(byName.convert.status).toBe("FAILED");
    expect(byName.convert.failedCount).toBe(1);
    expect(byName.convert.error).toEqual({
      name: "StepError",
      message: "boom",
    });
    expect(byName.convert.result).toBeUndefined();
  });

  it("excludes operations without a name", () => {
    const byName = buildOperationsByName([
      op({ id: "o1", status: "SUCCEEDED" }),
      op({ id: "o2", name: "named", status: "SUCCEEDED" }),
    ]);
    expect(Object.keys(byName)).toEqual(["named"]);
  });

  it("omits duration fields when no occurrence has a duration", () => {
    const byName = buildOperationsByName([
      op({ id: "o1", name: "wait-1", type: "WAIT", status: "SUCCEEDED" }),
    ]);
    expect(byName["wait-1"].minDurationMs).toBeUndefined();
    expect(byName["wait-1"].maxDurationMs).toBeUndefined();
    expect(byName["wait-1"].totalDurationMs).toBeUndefined();
  });

  it("initializes duration aggregates when only a later occurrence has a duration", () => {
    const byName = buildOperationsByName([
      op({ id: "o1", name: "x", status: "SUCCEEDED" }),
      op({ id: "o2", name: "x", status: "SUCCEEDED", durationMs: 50 }),
    ]);
    expect(byName.x.count).toBe(2);
    expect(byName.x.minDurationMs).toBe(50);
    expect(byName.x.maxDurationMs).toBe(50);
    expect(byName.x.totalDurationMs).toBe(50);
  });

  it("updates status/type to the most recently seen occurrence", () => {
    const byName = buildOperationsByName([
      op({ id: "o1", name: "x", type: "STEP", status: "SUCCEEDED" }),
      op({ id: "o2", name: "x", type: "STEP", status: "FAILED" }),
    ]);
    expect(byName.x.status).toBe("FAILED");
    expect(byName.x.failedCount).toBe(1);
  });
});

describe("withOperationsByName", () => {
  it("attaches operationsByName without mutating the original record", () => {
    const record = {
      operations: [op({ id: "o1", name: "step-a", durationMs: 5 })],
    } as unknown as WorkflowInsightRecord;

    const augmented = withOperationsByName(record);
    expect(augmented.operationsByName["step-a"].count).toBe(1);
    expect(
      (record as unknown as { operationsByName?: unknown }).operationsByName,
    ).toBeUndefined();
  });
});
