import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";

export const config: ExampleConfig = {
  name: "Oversized Execution Result",
  description:
    "Demonstrates returning a single oversized document (>6MB) from a durable " +
    "handler. The SDK checkpoints the execution result and returns SUCCEEDED " +
    "with an empty inline payload, while the caller still retrieves the full " +
    "document from the checkpointed execution result.",
};

interface ExportEvent {
  // Optional override so tests can tune the generated document size.
  rows?: number;
}

interface ExportResult {
  format: string;
  rowCount: number;
  byteLength: number;
  document: string;
}

// ~100 bytes of "cell" data per row, so each CSV line is comfortably sized and
// the overall document crosses the 6MB response limit at a realistic row count.
const CELL = "d".repeat(100);

/**
 * A realistic "generate and return a large export" workflow. The handler reads
 * small export parameters in a durable step, then builds a single large CSV
 * document and returns it directly.
 *
 * Unlike aggregating an array of records, here the oversized value is one big
 * string. This still trips the SDK's response-size guard: the serialized return
 * exceeds Lambda's 6MB limit, so the SDK writes an `execution-result-*`
 * checkpoint (Action SUCCEED, Type EXECUTION) and returns SUCCEEDED with an
 * empty inline Result. The full document remains retrievable from the
 * checkpointed execution result.
 */
export const handler = withDurableExecution(
  async (event: ExportEvent, context: DurableContext) => {
    // Small durable step describing the export. Its result is a few bytes.
    const spec = await context.step("prepare-export", async () => ({
      format: "csv",
      rows: event.rows ?? 60000,
    }));

    // Build the large document in memory. This is deterministic and derived
    // from the step result, so it does not need its own checkpoint.
    const lines: string[] = [];
    for (let i = 0; i < spec.rows; i++) {
      lines.push(`${i},user_${i},${CELL}`);
    }
    const document = lines.join("\n");

    const result: ExportResult = {
      format: spec.format,
      rowCount: spec.rows,
      byteLength: Buffer.byteLength(document, "utf8"),
      document,
    };

    // Returning this object (>6MB serialized) triggers the SDK's oversized
    // result checkpointing path.
    return result;
  },
);
