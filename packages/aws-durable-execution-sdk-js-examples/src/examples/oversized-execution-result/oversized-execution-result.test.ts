import { handler } from "./oversized-execution-result";
import { createTests } from "../../utils/test-helper";

// 6MB Lambda response limit (minus a small envelope) enforced by the SDK.
const LAMBDA_RESPONSE_SIZE_LIMIT = 6 * 1024 * 1024 - 50;

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("checkpoints an oversized document result and returns it in full", async () => {
      const execution = await runner.run();

      expect(execution.getStatus()).toBe("SUCCEEDED");

      const result = execution.getResult() as {
        format: string;
        rowCount: number;
        byteLength: number;
        document: string;
      };

      // The full document is recovered from the checkpointed execution result
      // even though it exceeded Lambda's inline response limit.
      expect(result.format).toBe("csv");
      expect(result.rowCount).toBe(60000);
      expect(result.document.startsWith("0,user_0,")).toBe(true);
      expect(result.document.split("\n")).toHaveLength(60000);
      expect(result.byteLength).toBe(
        Buffer.byteLength(result.document, "utf8"),
      );

      // Confirm the serialized result really is over the Lambda response limit,
      // i.e. this exercised the oversized-result path rather than an inline
      // return.
      const serializedSize = Buffer.byteLength(JSON.stringify(result), "utf8");
      expect(serializedSize).toBeGreaterThan(LAMBDA_RESPONSE_SIZE_LIMIT);

      // The durable step that produced the export spec completed successfully.
      const step = runner.getOperation("prepare-export");
      expect(step.getStepDetails()?.result).toEqual({
        format: "csv",
        rows: 60000,
      });

      assertEventSignatures(execution);
    }, 120000);
  },
});
