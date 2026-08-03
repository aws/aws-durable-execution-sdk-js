import { handler } from "./large-result-checkpointing";
import { createTests } from "../../utils/test-helper";

// 6MB Lambda response limit (minus a small envelope) enforced by the SDK.
const LAMBDA_RESPONSE_SIZE_LIMIT = 6 * 1024 * 1024 - 50;

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("checkpoints an oversized aggregated result and returns it in full", async () => {
      const execution = await runner.run();

      expect(execution.getStatus()).toBe("SUCCEEDED");

      const result = execution.getResult() as {
        totalRecords: number;
        totalBatches: number;
        records: { id: string; batch: number; data: string }[];
      };

      // The full result is recovered from the checkpoint even though it was too
      // large to be returned inline by Lambda.
      expect(result.totalBatches).toBe(6);
      expect(result.totalRecords).toBe(6000);
      expect(result.records).toHaveLength(6000);
      expect(result.records[0].id).toBe("rec-0-0");
      expect(result.records[result.records.length - 1].id).toBe("rec-5-999");

      // Confirm the serialized result is genuinely over the Lambda response
      // limit, i.e. this really exercised the oversized-result path and not the
      // ordinary inline return.
      const serializedSize = Buffer.byteLength(JSON.stringify(result), "utf8");
      expect(serializedSize).toBeGreaterThan(LAMBDA_RESPONSE_SIZE_LIMIT);

      // The single durable step still completed successfully.
      const step = runner.getOperation("load-batch-metadata");
      expect(step.getStepDetails()?.result).toEqual({
        batches: 6,
        recordsPerBatch: 1000,
      });

      assertEventSignatures(execution);
    }, 120000);
  },
});
