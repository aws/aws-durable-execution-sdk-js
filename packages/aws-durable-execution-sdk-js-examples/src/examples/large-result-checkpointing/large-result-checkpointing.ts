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
    "result instead of returning it inline, so callers still receive the full " +
    "aggregated result.",
};

interface AggregationEvent {
  // Optional override so tests can tune the generated result size.
  batches?: number;
  recordsPerBatch?: number;
}

interface AggregatedRecord {
  id: string;
  batch: number;
  data: string;
}

interface AggregationResult {
  totalRecords: number;
  totalBatches: number;
  records: AggregatedRecord[];
}

// ~1KB of payload per record. Kept as a module constant so the per-record size
// is obvious and easy to reason about when estimating the total result size.
const RECORD_DATA = "x".repeat(1024);

/**
 * A realistic "aggregate everything and return it" workflow: the handler reads
 * a small amount of batch metadata in a durable step, then assembles the full
 * dataset in memory and returns it.
 *
 * The individual step result stays tiny (well under the per-operation
 * checkpoint limit), but the assembled *return value* is far larger than
 * Lambda's 6MB response limit. The durable execution SDK detects this and
 * checkpoints the result as an `execution-result-*` checkpoint (Action SUCCEED,
 * Type EXECUTION) rather than attempting to return it inline — which would
 * otherwise be rejected by Lambda.
 */
export const handler = withDurableExecution(
  async (event: AggregationEvent, context: DurableContext) => {
    // Small, durable step: figure out how much data we are going to aggregate.
    // Its result is a few bytes, so it is checkpointed inline as usual.
    const plan = await context.step("load-batch-metadata", async () => ({
      batches: event.batches ?? 6,
      recordsPerBatch: event.recordsPerBatch ?? 1000,
    }));

    // Assemble the full dataset in memory. This is deterministic pure
    // computation derived from the step result, so it does not need its own
    // checkpoint — only the final return value matters for the oversize path.
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

    const result: AggregationResult = {
      totalRecords: records.length,
      totalBatches: plan.batches,
      records,
    };

    // Returning this object (>6MB serialized) triggers the SDK's oversized
    // result checkpointing path.
    return result;
  },
);
