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
  it("aggregates metrics across occurrences and snapshots the last occurrence", () => {
    const byName = buildOperationsByName([
      op({
        id: "o1",
        name: "charge",
        subType: "Step",
        status: "FAILED",
        startTime: "2026-01-01T00:00:01.000Z",
        durationMs: 100,
        attempt: 1,
        error: { name: "StepError", message: "e1" },
      }),
      op({
        id: "o2",
        name: "charge",
        subType: "Step",
        status: "SUCCEEDED",
        startTime: "2026-01-01T00:00:03.000Z",
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
      status: "SUCCEEDED", // last occurrence (later startTime) succeeded
      result: { ok: true }, // from the last occurrence
      // no error: last occurrence succeeded
    });
  });

  it("uses the same uniform shape for a single occurrence", () => {
    const byName = buildOperationsByName([
      op({ id: "o1", name: "insert", status: "SUCCEEDED", durationMs: 6200 }),
    ]);
    expect(byName.insert).toEqual({
      type: "STEP",
      count: 1,
      minDurationMs: 6200,
      maxDurationMs: 6200,
      totalDurationMs: 6200,
      failedCount: 0,
      status: "SUCCEEDED",
    });
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

  it("surfaces the last occurrence's error (and no result) when it failed", () => {
    const byName = buildOperationsByName([
      op({
        id: "o1",
        name: "convert",
        status: "SUCCEEDED",
        startTime: "2026-01-01T00:00:01.000Z",
        result: { a: 1 },
      }),
      op({
        id: "o2",
        name: "convert",
        status: "FAILED",
        startTime: "2026-01-01T00:00:05.000Z",
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

  it("breaks startTime ties by insertion order (later index wins)", () => {
    const byName = buildOperationsByName([
      op({ id: "o1", name: "x", status: "SUCCEEDED", result: { first: true } }),
      op({ id: "o2", name: "x", status: "SUCCEEDED", result: { last: true } }),
    ]);
    expect(byName.x.result).toEqual({ last: true });
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
