import {
  handler,
  CUSTOM_SUMMARY_MARKER,
} from "./parallel-custom-summary-generator";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should use the user-provided summaryGenerator for the checkpointed summary", async () => {
      // Default (large) payload exceeds the 256KB checkpoint limit, so the SDK
      // enters ReplayChildren mode and checkpoints the summaryGenerator output.
      const execution = await runner.run();

      const result = execution.getResult() as {
        totalCount: number;
        successCount: number;
        resultLengths: number[];
      };

      // The full results are still returned to the caller unchanged.
      expect(result.totalCount).toBe(3);
      expect(result.successCount).toBe(3);
      expect(result.resultLengths).toEqual([120000, 120000, 120000]);

      // The checkpointed CONTEXT result is now the SDK envelope (issue #751):
      // it always carries the load-bearing metadata (totalCount/successCount/
      // ...), and the user-provided generator's output is preserved verbatim
      // under `summary`. The customer here returns JSON, so `summary` is that
      // JSON string — asserting the marker inside it proves the user-supplied
      // generator was used (issue #500) while the SDK metadata is intact.
      const contextResult = runner
        .getOperation("parallel-large")
        .getContextDetails()?.result as {
        totalCount: number;
        successCount: number;
        summary: string;
      };

      expect(contextResult).toMatchObject({
        totalCount: 3,
        successCount: 3,
      });
      expect(JSON.parse(contextResult.summary)).toMatchObject({
        marker: CUSTOM_SUMMARY_MARKER,
        totalCount: 3,
        successCount: 3,
      });
    });

    it("should return correct results for a small payload", async () => {
      // A small payload stays within a single checkpoint (default behavior).
      // This case validates event signatures without committing a large
      // history fixture (large-payload runs replay children and would bloat it).
      const execution = await runner.run({
        payload: { branchPayloadSize: 10 },
      });

      const result = execution.getResult() as {
        totalCount: number;
        successCount: number;
        resultLengths: number[];
      };

      expect(result.totalCount).toBe(3);
      expect(result.successCount).toBe(3);
      expect(result.resultLengths).toEqual([10, 10, 10]);

      assertEventSignatures(execution);
    });
  },
});
