import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Promise Race Timing",
  description:
    "Test that context.promise.race returns when the first operation completes and takes approximately 1 second",
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    // Execute the race and measure duration in a single step
    const startTime = await context.step("record-start-time", async () => {
      return Date.now();
    });

    // Execute the race between 1 second and 10 second waits
    await context.promise.race([
      context.wait("wait-1-second", { seconds: 1 }),
      context.wait("wait-3-seconds", { seconds: 3 }),
    ]);

    // Should instantly resolve
    await context.promise.race<unknown>([
      context.step(() => Promise.resolve("quick resolve")),
      context.wait("wait-3-seconds-2", { seconds: 3 }),
    ]);

    // Record end time and calculate duration using a durable step
    const duration = await context.step("calculate-duration", async () => {
      const endTime = Date.now();
      return endTime - startTime;
    });

    return duration;
  },
);
