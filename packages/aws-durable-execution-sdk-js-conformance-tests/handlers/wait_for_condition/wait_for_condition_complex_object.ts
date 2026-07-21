// 6-9: Wait-for-condition with a complex object state
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

interface PollState {
  status: string;
  attempts: number;
}

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.waitForCondition(
      async (state: PollState) => {
        const newAttempts = state.attempts + 1;
        return {
          status: newAttempts >= 2 ? "DONE" : "PENDING",
          attempts: newAttempts,
        };
      },
      {
        waitStrategy: (state: PollState, _attempt: number) => {
          if (state.status === "DONE") {
            return { shouldContinue: false };
          }
          return { shouldContinue: true, delay: { seconds: 1 } };
        },
        initialState: { status: "PENDING", attempts: 0 },
      },
    );
    return result;
  },
);
