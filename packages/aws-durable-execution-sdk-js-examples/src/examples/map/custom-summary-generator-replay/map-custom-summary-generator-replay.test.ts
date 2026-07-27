import {
  handler,
  CUSTOM_SUMMARY_PREFIX,
} from "./map-custom-summary-generator-replay";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  localRunnerConfig: {
    // Real timers: items complete based on setTimeout so minSuccessful can be
    // reached while a middle item is still in flight (STARTED).
    skipTime: false,
    checkpointDelay: 100,
  },
  tests: (runner, { assertEventSignatures }) => {
    it("replays a summarized map with a free-form custom summary without hanging (issue #751)", async () => {
      // Default (large) payload: two successes exceed the 256KB checkpoint
      // limit, so the map is checkpointed as a summary (ReplayChildren) and is
      // reconstructed from child checkpoints on resume.
      const execution = await runner.run();

      // Primary regression assertion: the execution completes. On an unpatched
      // SDK the replay after suspend/resume hangs (a never-resolving promise in
      // ReplaySucceededContext mode) and this run times out.
      expect(execution.getStatus()).toBe("SUCCEEDED");

      const result = execution.getResult() as {
        totalCount: number;
        successCount: number;
        startedCount: number;
        completionReason: string;
        itemIndexes: number[];
      };

      // Summarized replay (ReplayChildren) returns only the COMPLETED items;
      // in-flight items are not rebuilt. The live run completed items 0 and 2
      // (item 1 still in flight), so replay observes those two. The batch
      // outcome comes from the recorded completionReason.
      expect(result.successCount).toBe(2);
      expect(result.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
      expect(result.totalCount).toBe(2);
      expect(result.startedCount).toBe(0);
      expect(result.itemIndexes).toEqual([0, 2]);

      // The checkpointed summary is the SDK envelope: the load-bearing metadata
      // is always recorded, and the customer's free-form string is preserved
      // verbatim under `summary` (observability-only). The envelope is written
      // on the live run, so its totalCount reflects the live started set (3).
      const summary = runner.getOperation("summarized-map").getContextDetails()
        ?.result as {
        totalCount: number;
        successCount: number;
        completionReason: string;
        summary: string;
      };
      expect(summary.totalCount).toBe(3);
      expect(summary.successCount).toBe(2);
      expect(summary.summary.startsWith(CUSTOM_SUMMARY_PREFIX)).toBe(true);
    }, 30000);

    it("preserves the full live shape (including the in-flight item) when the result fits in one checkpoint", async () => {
      // A small payload stays within a single checkpoint (no ReplayChildren),
      // so the full map result is checkpointed and replay returns it from cache
      // — including the STARTED (in-flight) item. This is the counterpart to the
      // summarized case above: identical handler, but here totalCount/startedCount
      // reflect the live run (3/1) rather than the completed-only reconstruction
      // (2/0). It also validates event signatures against a committed history
      // without needing a large-payload fixture.
      const execution = await runner.run({ payload: { itemPayloadSize: 16 } });

      expect(execution.getStatus()).toBe("SUCCEEDED");

      const result = execution.getResult() as {
        totalCount: number;
        successCount: number;
        startedCount: number;
        completionReason: string;
        itemIndexes: number[];
      };
      expect(result.successCount).toBe(2);
      expect(result.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
      // Full cached result: the in-flight item 1 is preserved (contrast the
      // summarized test above, which reconstructs completed items only).
      expect(result.totalCount).toBe(3);
      expect(result.startedCount).toBe(1);
      expect(result.itemIndexes).toEqual([0, 1, 2]);

      assertEventSignatures(execution);
    }, 30000);
  },
});
