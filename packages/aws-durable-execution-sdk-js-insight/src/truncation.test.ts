import { truncateRecord } from "./truncation";
import type { OperationRecord, WorkflowInsightRecord } from "./types";

function op(
  partial: Partial<OperationRecord> & { id: string },
): OperationRecord {
  return {
    type: "STEP",
    status: "SUCCEEDED",
    ...partial,
  } as OperationRecord;
}

function record(
  partial: Partial<WorkflowInsightRecord> = {},
): WorkflowInsightRecord {
  return {
    recordType: "WorkflowInsight",
    schemaVersion: "1.0",
    emittedAt: "2026-07-02T00:00:00.000Z",
    executionArn:
      "arn:aws:lambda:us-east-1:123:function:fn:1/durable-execution/e/i",
    functionName: "fn",
    functionQualifier: "1",
    region: "us-east-1",
    accountId: "123",
    status: "SUCCEEDED",
    startTime: "2026-07-02T00:00:00.000Z",
    operations: [],
    ...partial,
  };
}

const bytes = (r: unknown): number =>
  new TextEncoder().encode(JSON.stringify(r)).length;

describe("truncateRecord", () => {
  it("returns the original record unchanged when it fits", () => {
    const r = record({ operations: [op({ id: "o1", name: "a" })] });
    const out = truncateRecord(r, 10_000);
    expect(out).toBe(r); // same reference — no copy
    expect(out.truncated).toBeUndefined();
  });

  it("returns the original when no limit is set", () => {
    const r = record({
      operations: [op({ id: "o1", name: "a", result: "x".repeat(1000) })],
    });
    expect(truncateRecord(r, undefined)).toBe(r);
    expect(truncateRecord(r, 0)).toBe(r);
  });

  it("drops operation results oldest-first until it fits, marking truncated", () => {
    const ops = [
      op({
        id: "o1",
        name: "old",
        startTime: "2026-07-02T00:00:01.000Z",
        result: "A".repeat(500),
      }),
      op({
        id: "o2",
        name: "new",
        startTime: "2026-07-02T00:00:02.000Z",
        result: "B".repeat(500),
      }),
    ];
    const r = record({ operations: ops });
    const full = bytes(r);
    // Limit that forces dropping exactly one result (the oldest).
    const limit = full - 400;

    const out = truncateRecord(r, limit);

    expect(out).not.toBe(r);
    expect(out.truncated).toBe(true);
    expect(out.droppedOperationResults).toBe(1);
    expect(out.droppedOperations).toBeUndefined();
    // Oldest (o1) lost its result; newest (o2) kept it. Both operations remain.
    expect(out.operations).toHaveLength(2);
    expect(out.operations.find((o) => o.id === "o1")?.result).toBeUndefined();
    expect(out.operations.find((o) => o.id === "o2")?.result).toBe(
      "B".repeat(500),
    );
    expect(bytes(out)).toBeLessThanOrEqual(limit);
  });

  it("drops whole operations oldest-first after results are exhausted", () => {
    const ops = Array.from({ length: 5 }, (_, i) =>
      op({
        id: `o${i}`,
        name: `step-${i}`,
        startTime: `2026-07-02T00:00:0${i}.000Z`,
      }),
    );
    const r = record({ operations: ops });
    // Tight limit that no result-dropping can satisfy (there are no results),
    // forcing whole-operation drops.
    const limit = bytes(record({ operations: ops.slice(0, 2) })) + 20;

    const out = truncateRecord(r, limit);

    expect(out.truncated).toBe(true);
    expect(out.droppedOperations).toBeGreaterThan(0);
    // The survivors must be the newest ones (oldest dropped first).
    const survivingIds = out.operations.map((o) => o.id);
    expect(survivingIds).not.toContain("o0");
    expect(bytes(out)).toBeLessThanOrEqual(limit);
  });

  it("does not mutate the input record (shared across exporters)", () => {
    const ops = [op({ id: "o1", name: "a", result: "X".repeat(1000) })];
    const r = record({ operations: ops });
    const before = JSON.stringify(r);

    truncateRecord(r, bytes(r) - 500);

    expect(JSON.stringify(r)).toBe(before);
    expect(r.operations[0].result).toBe("X".repeat(1000));
    expect(r.truncated).toBeUndefined();
  });

  it("leaves input/output untouched and returns original if nothing can be dropped", () => {
    // No operations to shed; a huge input keeps the record over the limit.
    const r = record({ input: { blob: "Z".repeat(5000) }, operations: [] });
    const out = truncateRecord(r, 100);
    // Nothing was actually cut → original returned, no misleading marker.
    expect(out).toBe(r);
    expect(out.truncated).toBeUndefined();
    expect(out.input).toEqual({ blob: "Z".repeat(5000) });
  });

  it("treats operations without a startTime as newest (dropped last)", () => {
    const ops = [
      op({ id: "timed", name: "timed", startTime: "2026-07-02T00:00:01.000Z" }),
      op({ id: "untimed", name: "untimed" }), // no startTime
    ];
    const r = record({ operations: ops });
    // Force dropping exactly one whole operation.
    const limit = bytes(record({ operations: [ops[0]] })) + 5;

    const out = truncateRecord(r, limit);

    expect(out.droppedOperations).toBe(1);
    // The timed (older) op is dropped; the untimed one survives.
    expect(out.operations.map((o) => o.id)).toEqual(["untimed"]);
  });
});
