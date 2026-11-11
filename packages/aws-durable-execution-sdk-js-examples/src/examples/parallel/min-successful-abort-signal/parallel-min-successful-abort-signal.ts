import { setTimeout as sleep } from "node:timers/promises";
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Parallel minSuccessful with abort signal",
  description:
    "Stops the losing branch of a parallel race with the step abort signal",
};

// Much longer than the whole example runs when the slow step stops early.
export const SLOW_STEP_MS = 30_000;

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const race = await context.parallel(
      "race",
      [
        {
          name: "fast",
          func: (ctx) => ctx.step("fast", async () => "fast"),
        },
        {
          name: "slow",
          func: (ctx) =>
            ctx.step("slow", async (stepCtx) => {
              // The SDK aborts stepCtx.signal when "race" completes without
              // this step. Pass it to fetch or to AWS SDK calls the same way.
              await sleep(SLOW_STEP_MS, undefined, { signal: stepCtx.signal });
              return "slow";
            }),
        },
      ],
      { completionConfig: { minSuccessful: 1 } },
    );

    // The invocation can suspend here only when no step runs. Without the
    // signal, it would wait for the slow step to return.
    await context.wait("pause", { seconds: 1 });

    return race.getResults();
  },
);
