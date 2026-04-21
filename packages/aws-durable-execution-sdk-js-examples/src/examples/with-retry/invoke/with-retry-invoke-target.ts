import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "With Retry - Invoke Target",
  description:
    "Target function for with-retry-invoke example. Fails when the provided attempt is below failUntilAttempt.",
};

export const handler = withDurableExecution(
  async (
    event: { attempt: number; failUntilAttempt: number },
    _context: DurableContext,
  ): Promise<{ attempt: number; success: true }> => {
    if (event.attempt < event.failUntilAttempt) {
      throw new Error(`Intentional failure on attempt ${event.attempt}`);
    }
    return { attempt: event.attempt, success: true };
  },
);
