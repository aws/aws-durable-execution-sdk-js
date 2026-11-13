import { it, expect, vi } from "vitest";
import { truncateRecordWithOperationsFormat } from "./truncation";
import { applyOperationsFormat } from "./operations-index";
import type { DurableExecutionTelemetryRecord, OperationRecord } from "./types";

// Counts the operation records handed to the name index. A removal that rescans
// every remaining operation with the same name costs O(n) here per removal, so
// the total grows with n squared. The indexed path only touches the removed
// operation.
const indexed = vi.hoisted(() => ({ records: 0 }));

vi.mock("./operations-index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./operations-index")>();
  return {
    ...actual,
    buildOperationsByName: (operations: OperationRecord[]) => {
      indexed.records += operations.length;
      return actual.buildOperationsByName(operations);
    },
  };
});

it("keeps name-index work linear when many operations share one name", () => {
  const count = 2000;
  const operations = Array.from({ length: count }, (_, i) => ({
    id: `op-${i}`,
    name: "charge",
    type: "STEP",
    status: i % 4 === 0 ? "FAILED" : "SUCCEEDED",
    startTime: new Date(Date.UTC(2026, 6, 2) + i * 10).toISOString(),
    durationMs: i,
  })) as OperationRecord[];
  const record = {
    recordType: "DurableExecutionTelemetry",
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
    operations,
  } as DurableExecutionTelemetryRecord;
  const render = (value: DurableExecutionTelemetryRecord) =>
    applyOperationsFormat(value, "both");
  const limit = Math.floor(
    new TextEncoder().encode(JSON.stringify(render(record))).length / 2,
  );

  indexed.records = 0;
  const out = truncateRecordWithOperationsFormat(record, limit, render, {
    operations: "both",
  });

  expect(out.droppedOperations).toBeGreaterThan(0);
  expect(out.operations.length).toBeLessThan(count);
  // One pass to index the input plus one update per removed operation. A
  // rescan per removal would process about count * count / 4 records (1M here).
  expect(indexed.records).toBeLessThan(10 * count);
}, 60_000);
