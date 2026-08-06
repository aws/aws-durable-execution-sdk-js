import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";

export const config: ExampleConfig = {
  name: "Large Result Checkpointing",
  description:
    "Demonstrates a durable handler whose FINAL return value exceeds the 6MB " +
    "Lambda response limit. The SDK transparently checkpoints the oversized " +
    "result as an `execution-result-*` checkpoint (Action SUCCEED, Type " +
    "EXECUTION) instead of returning it inline, so callers still receive the " +
    "full result. Two `mode`s exercise the same oversize path with different " +
    "shapes: 'records' aggregates a large array of records, while 'document' " +
    "returns a single oversized string.",
};

// Two shapes of oversized result, selected by `event.mode`. Both trip the same
// SDK response-size guard; they differ only in whether the oversized value is a
// large array of records or one large string.
type Mode = "records" | "document";

interface LargeResultEvent {
  mode?: Mode;
  // Optional overrides so tests can tune the generated result size.
  batches?: number;
  recordsPerBatch?: number;
  rows?: number;
}

interface AggregatedRecord {
  id: string;
  batch: number;
  data: string;
}

interface RecordsResult {
  mode: "records";
  totalRecords: number;
  totalBatches: number;
  records: AggregatedRecord[];
}

interface DocumentResult {
  mode: "document";
  format: string;
  rowCount: number;
  byteLength: number;
  document: string;
}

// ~1KB of payload per record. Kept as a module constant so the per-record size
// is obvious and easy to reason about when estimating the total result size.
const RECORD_DATA = "x".repeat(1024);

// ~100 bytes of "cell" data per row, so each CSV line is comfortably sized and
// the overall document crosses the 6MB response limit at a realistic row count.
const CELL = "d".repeat(100);

/**
 * "records" mode: a realistic "aggregate everything and return it" workflow.
 * The handler reads a small amount of batch metadata in a durable step, then
 * assembles the full dataset in memory and returns it as one big array.
 */
async function aggregateRecords(
  event: LargeResultEvent,
  context: DurableContext,
): Promise<RecordsResult> {
  // Small, durable step: figure out how much data we are going to aggregate.
  // Its result is a few bytes, so it is checkpointed inline as usual.
  const plan = await context.step("load-batch-metadata", async () => ({
    batches: event.batches ?? 6,
    recordsPerBatch: event.recordsPerBatch ?? 1000,
  }));

  // Assemble the full dataset in memory. This is deterministic pure computation
  // derived from the step result, so it does not need its own checkpoint — only
  // the final return value matters for the oversize path.
  const records: AggregatedRecord[] = [];
  for (let batch = 0; batch < plan.batches; batch++) {
    for (let record = 0; record < plan.recordsPerBatch; record++) {
      records.push({
        id: `rec-${batch}-${record}`,
        batch,
        data: RECORD_DATA,
      });
    }
  }

  return {
    mode: "records",
    totalRecords: records.length,
    totalBatches: plan.batches,
    records,
  };
}

/**
 * "document" mode: a realistic "generate and return a large export" workflow.
 * The handler reads small export parameters in a durable step, then builds a
 * single large CSV document and returns it directly. Unlike aggregating an
 * array, here the oversized value is one big string.
 */
async function buildDocument(
  event: LargeResultEvent,
  context: DurableContext,
): Promise<DocumentResult> {
  // Small durable step describing the export. Its result is a few bytes.
  const spec = await context.step("prepare-export", async () => ({
    format: "csv",
    rows: event.rows ?? 60000,
  }));

  // Build the large document in memory. This is deterministic and derived from
  // the step result, so it does not need its own checkpoint.
  const lines: string[] = [];
  for (let i = 0; i < spec.rows; i++) {
    lines.push(`${i},user_${i},${CELL}`);
  }
  const document = lines.join("\n");

  return {
    mode: "document",
    format: spec.format,
    rowCount: spec.rows,
    byteLength: Buffer.byteLength(document, "utf8"),
    document,
  };
}

/**
 * The individual step result stays tiny (well under the per-operation
 * checkpoint limit), but the assembled *return value* is far larger than
 * Lambda's 6MB response limit. The durable execution SDK detects this and
 * checkpoints the result as an `execution-result-*` checkpoint (Action SUCCEED,
 * Type EXECUTION) rather than attempting to return it inline — which would
 * otherwise be rejected by Lambda.
 */
export const handler = withDurableExecution(
  async (event: LargeResultEvent, context: DurableContext) => {
    const mode: Mode = event?.mode ?? "records";

    // Returning either shape (>6MB serialized) triggers the SDK's oversized
    // result checkpointing path.
    if (mode === "document") {
      return buildDocument(event, context);
    }

    return aggregateRecords(event, context);
  },
);
