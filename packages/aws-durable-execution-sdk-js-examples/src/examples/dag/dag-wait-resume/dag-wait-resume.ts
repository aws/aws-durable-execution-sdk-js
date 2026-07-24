import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Dag Wait Resume",
  description:
    "A DAG containing a wait task, proving durable suspend/resume replay across the DAG scheduler",
};

/**
 * A linear DAG with a wait task in the middle:
 *
 *   prepare (step) -> pause (wait 3s) -> finalize (step)
 *
 * The `pause` task suspends the execution with no compute charges; the Lambda
 * is re-invoked after the wait elapses and the DAG scheduler resumes,
 * replaying `prepare` from its checkpoint (without re-running it) and driving
 * `finalize`. This exercises the DAG replay path across a real suspend.
 */
export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag("pipeline", (d) => {
      const prepare = d.step(
        "prepare",
        [],
        async (): Promise<string> => "prepared",
      );
      const pause = d.wait("pause", [prepare], { seconds: 3 });
      d.step("finalize", [pause], async (): Promise<string> => "finalized");
    });

    return {
      completionReason: result.completionReason,
      prepare: result.getResult("prepare"),
      pauseStatus: result.getStatus("pause"),
      finalize: result.getResult("finalize"),
      successCount: result.successCount,
      totalCount: result.totalCount,
    };
  },
);
