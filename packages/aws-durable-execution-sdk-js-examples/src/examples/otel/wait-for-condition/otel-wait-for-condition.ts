import {
  createWaitStrategy,
  DurableContext,
  JitterStrategy,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { createOtelTestSetup } from "../shared/otel-test-setup";

const { plugin, exporter, getSerializedSpans } = createOtelTestSetup();

export const config: ExampleConfig = {
  name: "OTel Wait for Condition",
};

/**
 * Reset the span exporter. Call this before running the handler
 * to get a clean set of spans for the test.
 */
export function resetExporter(): void {
  exporter.reset();
}

interface WaitForConditionEvent {
  mode?: "immediate" | "normal" | "exhausted";
}

export const handler = withDurableExecution(
  async (event: WaitForConditionEvent, context: DurableContext) => {
    const mode = event.mode ?? "normal";

    if (mode === "immediate") {
      // Condition is already met on first check (1 poll)
      const finalState = await context.waitForCondition(
        async (state: { counter: number }) => {
          return { counter: state.counter };
        },
        {
          waitStrategy: (state: { counter: number }) => {
            return { shouldContinue: false };
          },
          initialState: { counter: 3 },
        },
      );
      return { finalState, mode, spans: getSerializedSpans() };
    }

    if (mode === "exhausted") {
      // Condition never met, exhausts maxAttempts (5)
      const finalState = await context.waitForCondition(
        async (state: { counter: number }) => {
          return { counter: state.counter + 1 };
        },
        {
          waitStrategy: createWaitStrategy<{ counter: number }>({
            maxAttempts: 5,
            initialDelay: { seconds: 1 },
            maxDelay: { seconds: 1 },
            backoffRate: 1,
            jitter: JitterStrategy.NONE,
            shouldContinuePolling: () => true,
          }),
          initialState: { counter: 0 },
        },
      );
      return { finalState, mode, spans: getSerializedSpans() };
    }

    // Normal mode: polls 3 times
    const finalState = await context.waitForCondition(
      async (state: { counter: number }) => {
        return { counter: state.counter + 1 };
      },
      {
        waitStrategy: (state: { counter: number }) => {
          if (state.counter >= 3) {
            return { shouldContinue: false };
          }
          return { shouldContinue: true, delay: { seconds: 1 } };
        },
        initialState: { counter: 0 },
      },
    );

    return { finalState, mode, spans: getSerializedSpans() };
  },
  { plugins: [plugin] },
);
