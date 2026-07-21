// 9-19: Map with an operation-level (whole-result) serdes — serialize on a fresh operation
import {
  DurableContext,
  withDurableExecution,
  Serdes,
  SerdesContext,
  BatchResult,
  BatchItemStatus,
} from "@aws/durable-execution-sdk-js";

// Operation-level serde: serializes the whole BatchResult to "OPSERDE:<comma-joined results>"
// and reconstructs a BatchResult on deserialize. Real, non-identity round-trip.
const opSerdes: Serdes<BatchResult<string>> = {
  serialize: async (
    value: BatchResult<string> | undefined,
    _c: SerdesContext,
  ) =>
    value === undefined ? undefined : `OPSERDE:${value.getResults().join(",")}`,
  deserialize: async (data: string | undefined, _c: SerdesContext) => {
    if (data === undefined) return undefined;
    const vals = data.replace(/^OPSERDE:/, "").split(",");
    // Return a plain shape; the SDK's restoreBatchResult wraps it with methods.
    return {
      all: vals.map((v, i) => ({
        index: i,
        status: BatchItemStatus.SUCCEEDED,
        result: v,
      })),
      completionReason: "ALL_COMPLETED",
    } as unknown as BatchResult<string>;
  },
};

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.map(
      "op-serde",
      ["x", "y"],
      async (_ctx: DurableContext, item: string) => item.toUpperCase(),
      { maxConcurrency: 1, serdes: opSerdes },
    );
    return results.getResults();
  },
);
