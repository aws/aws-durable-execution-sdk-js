import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Parallel Custom Summary Generator",
  description:
    "Demonstrates supplying a custom summaryGenerator to context.parallel " +
    "(issue #500). When the batch result exceeds the checkpoint size limit, " +
    "the SDK checkpoints the summaryGenerator output instead of the full payload.",
};

/**
 * Marker embedded in the custom summary so the test can prove the
 * user-provided generator was used instead of the SDK default.
 */
export const CUSTOM_SUMMARY_MARKER = "custom-parallel-summary";

/**
 * Each branch returns a string of `branchPayloadSize` characters. Three
 * branches of ~120KB push the serialized BatchResult past the 256KB checkpoint
 * limit, which triggers ReplayChildren mode — the only path where
 * summaryGenerator is invoked. A small size keeps the run within a single
 * checkpoint (default behavior) and is used to validate event signatures
 * without committing a large history fixture.
 */
const DEFAULT_BRANCH_PAYLOAD_SIZE = 120_000;

interface CustomSummaryEvent {
  branchPayloadSize?: number;
}

export const handler = withDurableExecution(
  async (event: CustomSummaryEvent | undefined, context: DurableContext) => {
    const branchPayloadSize =
      event?.branchPayloadSize ?? DEFAULT_BRANCH_PAYLOAD_SIZE;

    const results = await context.parallel(
      "parallel-large",
      [
        async (ctx) =>
          ctx.step("branch-0", async () => "a".repeat(branchPayloadSize)),
        async (ctx) =>
          ctx.step("branch-1", async () => "b".repeat(branchPayloadSize)),
        async (ctx) =>
          ctx.step("branch-2", async () => "c".repeat(branchPayloadSize)),
      ],
      {
        maxConcurrency: 3,
        summaryGenerator: (result) =>
          JSON.stringify({
            marker: CUSTOM_SUMMARY_MARKER,
            totalCount: result.totalCount,
            successCount: result.successCount,
          }),
      },
    );

    return {
      totalCount: results.totalCount,
      successCount: results.successCount,
      resultLengths: results
        .getResults()
        .map((value) => (value as string).length),
    };
  },
);
