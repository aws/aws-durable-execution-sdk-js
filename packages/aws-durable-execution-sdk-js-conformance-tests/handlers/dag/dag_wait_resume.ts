// 10-4: DAG in-graph Wait task (suspend and resume)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag(
      "waitresume",
      (d) => {
        const start = d.step(
          "start",
          [],
          async (): Promise<string> => "started",
        );
        const pause = d.wait("pause", [start], { seconds: 5 });
        d.step("finish", [pause], async (): Promise<string> => "resumed");
      },
      { maxConcurrency: 1 },
    );

    return {
      reason: result.completionReason,
      statuses: {
        start: result.getStatus("start"),
        pause: result.getStatus("pause"),
        finish: result.getStatus("finish"),
      },
      counts: [
        result.successCount,
        result.failureCount,
        result.skippedCount,
        result.totalCount,
      ],
      marker: result.getResult("finish"),
    };
  },
);
