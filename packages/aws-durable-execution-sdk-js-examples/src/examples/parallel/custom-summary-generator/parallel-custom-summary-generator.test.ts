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

      // The CONTEXT operation's checkpointed result is the summaryGenerator
      // output. Asserting the custom marker proves the user-supplied generator
      // was used instead of the SDK's default parallel generator (issue #500).
      const contextResult = runner
        .getOperation("parallel-large")
        .getContextDetails()?.result as {
        marker: string;
        totalCount: number;
        successCount: number;
      };

      expect(contextResult).toMatchObject({
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
