// 10-8: DAG task that is a waitForCondition completing after N deterministic polls
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag(
      "wfcdag",
      (d) => {
        // DAG task whose native op is a waitForCondition. The check starts at 0
        // and increments by 1 each poll; it stops once the state reaches 2, so
        // it completes after a deterministic number of polls. Checkpointed
        // directly under the Dag container (flat).
        const poll = d.waitForCondition(
          "poll",
          [],
          async (state: number): Promise<number> => state + 1,
          {
            initialState: 0,
            waitStrategy: (state: number) =>
              state >= 2
                ? { shouldContinue: false }
                : { shouldContinue: true, delay: { seconds: 1 } },
          },
        );

        // Downstream step depending on the waitForCondition final state,
        // proving the DAG resumes across the suspend/resume boundary.
        d.step(
          "done",
          [poll],
          async (deps): Promise<number> => (deps.poll as number) * 5,
        );
      },
      { maxConcurrency: 1 },
    );

    return {
      reason: result.completionReason,
      statuses: {
        poll: result.getStatus("poll"),
        done: result.getStatus("done"),
      },
      counts: [
        result.successCount,
        result.failureCount,
        result.skippedCount,
        result.totalCount,
      ],
      poll: result.getResult("poll"),
      done: result.getResult("done"),
    };
  },
);
