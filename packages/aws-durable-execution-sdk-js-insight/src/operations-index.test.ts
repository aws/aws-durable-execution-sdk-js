import {
  applyOperationsFormat,
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

  it("initializes maxAttempt when only a later occurrence has an attempt", () => {
    const byName = buildOperationsByName([
      op({ id: "o1", name: "x", status: "SUCCEEDED" }), // no attempt
      op({ id: "o2", name: "x", status: "SUCCEEDED", attempt: 4 }),
    ]);
    expect(byName.x.count).toBe(2);
    expect(byName.x.maxAttempt).toBe(4);
  });

  it("updates status/type to the most recently seen occurrence", () => {
    const byName = buildOperationsByName([
      op({ id: "o1", name: "x", type: "STEP", status: "SUCCEEDED" }),
      op({ id: "o2", name: "x", type: "STEP", status: "FAILED" }),
    ]);
    expect(byName.x.status).toBe("FAILED");
    expect(byName.x.failedCount).toBe(1);
  });

  it("reflects the latest occurrence's subType (clears a stale earlier one)", () => {
    const byName = buildOperationsByName([
      op({ id: "o1", name: "x", subType: "Batch", status: "SUCCEEDED" }),
      op({ id: "o2", name: "x", status: "SUCCEEDED" }), // no subType
    ]);
    expect(byName.x.count).toBe(2);
    expect(byName.x.subType).toBeUndefined();
  });

  it("does not pollute Object.prototype for a '__proto__' operation name", () => {
    const byName = buildOperationsByName([
      op({ id: "o1", name: "__proto__", status: "SUCCEEDED", durationMs: 5 }),
      // second occurrence exercises the update + delete path
      op({ id: "o2", name: "__proto__", status: "FAILED", durationMs: 9 }),
    ]);

    // Object.prototype must be untouched.
    expect(({} as Record<string, unknown>).count).toBeUndefined();
    expect(({} as Record<string, unknown>).status).toBeUndefined();

    // The summary is stored as an own data property, not on the prototype.
    const desc = Object.getOwnPropertyDescriptor(byName, "__proto__");
    expect(desc?.value?.count).toBe(2);
    expect(desc?.value?.status).toBe("FAILED");
  });

  it("serializes a '__proto__' entry through JSON without polluting (round-trip)", () => {
    const byName = buildOperationsByName([
      op({ id: "o1", name: "__proto__", status: "SUCCEEDED", durationMs: 5 }),
    ]);

    const json = JSON.stringify(byName);
    // The entry is actually emitted (so it reaches CloudWatch/etc., not dropped).
    expect(json).toContain('"__proto__"');

    const parsed = JSON.parse(json);
    // Round-trip must not pollute Object.prototype...
    expect(({} as Record<string, unknown>).count).toBeUndefined();
    // ...and the summary is recoverable as an own property.
    const desc = Object.getOwnPropertyDescriptor(parsed, "__proto__");
    expect(desc?.value?.count).toBe(1);
  });
});

describe("withOperationsByName", () => {
  it("replaces operations with operationsByName without mutating the original", () => {
    const record = {
      operations: [op({ id: "o1", name: "step-a", durationMs: 5 })],
    } as unknown as WorkflowInsightRecord;

    const out = withOperationsByName(record);
    expect(out.operationsByName["step-a"].count).toBe(1);
    // the array is dropped from the emitted record...
    expect(
      (out as unknown as { operations?: unknown }).operations,
    ).toBeUndefined();
    // ...but the original record is not mutated.
    expect(record.operations).toHaveLength(1);
  });
});

describe("applyOperationsFormat", () => {
  const record = {
    operations: [
      op({ id: "o1", name: "step-a", durationMs: 5 }),
      op({ id: "o2", name: "step-a", durationMs: 7 }),
    ],
  } as unknown as WorkflowInsightRecord;

  it("array: returns the record unchanged", () => {
    const out = applyOperationsFormat(record, "array") as WorkflowInsightRecord;
    expect(out.operations).toHaveLength(2);
    expect(
      (out as unknown as { operationsByName?: unknown }).operationsByName,
    ).toBeUndefined();
  });

  it("by-name: replaces the array with the map", () => {
    const out = applyOperationsFormat(record, "by-name") as {
      operations?: unknown;
      operationsByName: Record<string, { count: number }>;
    };
    expect(out.operations).toBeUndefined();
    expect(out.operationsByName["step-a"].count).toBe(2);
  });

  it("both: keeps the array and adds the map", () => {
    const out = applyOperationsFormat(record, "both") as {
      operations: unknown[];
      operationsByName: Record<string, { count: number }>;
    };
    expect(out.operations).toHaveLength(2);
    expect(out.operationsByName["step-a"].count).toBe(2);
  });
});
