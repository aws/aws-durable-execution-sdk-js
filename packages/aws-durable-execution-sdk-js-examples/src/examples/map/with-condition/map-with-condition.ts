import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Map with Wait for Condition",
  description:
    "Demonstrates map operation where each iteration polls until a condition is met",
};

interface JobItem {
  id: number;
  name: string;
  completesAfterChecks: number;
}

/**
 * Each map iteration:
 * 1. Runs a step to submit a job
 * 2. Polls with waitForCondition until the job is "complete"
 * 3. Runs a final step to collect the result
 *
 * The polling simulates checking an external system (e.g., a batch job, ML training run).
 */
export const handler = withDurableExecution(
  async (event: { jobs?: JobItem[] }, context: DurableContext) => {
    const jobs = event.jobs ?? [
      { id: 1, name: "job-fast", completesAfterChecks: 1 },
      { id: 2, name: "job-medium", completesAfterChecks: 2 },
      { id: 3, name: "job-slow", completesAfterChecks: 3 },
    ];

    const results = await context.map(
      "job-pipeline",
      jobs,
      async (ctx: DurableContext, job: JobItem, index: number) => {
        // Step 1: Submit the job
        const submitted = await ctx.step(`submit-${job.name}`, async () => ({
          jobId: job.id,
          jobName: job.name,
          submittedAt: "2025-01-01T00:00:00Z",
        }));

        // Step 2: Poll until the job completes
        const finalState = await ctx.waitForCondition<{
          jobId: number;
          checkCount: number;
          status: string;
        }>(
          `poll-${job.name}`,
          async (currentState) => {
            // Simulate checking job status — completes after N checks
            const newCheckCount = currentState.checkCount + 1;
            const isComplete = newCheckCount >= job.completesAfterChecks;
            return {
              ...currentState,
              checkCount: newCheckCount,
              status: isComplete ? "completed" : "running",
            };
          },
          {
            initialState: {
              jobId: job.id,
              checkCount: 0,
              status: "pending",
            },
            waitStrategy: (state, attempt) => ({
              shouldContinue: state.status !== "completed",
              delay: { seconds: 1 },
            }),
          },
        );

        // Step 3: Collect the result
        const collected = await ctx.step(`collect-${job.name}`, async () => ({
          ...submitted,
          finalStatus: finalState.status,
          totalChecks: finalState.checkCount,
        }));

        return collected;
      },
      { maxConcurrency: 3 },
    );

    return {
      totalProcessed: results.successCount,
      totalFailed: results.failureCount,
      completionReason: results.completionReason,
      jobs: results.getResults(),
    };
  },
);
