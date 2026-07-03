import {
  createWaitStrategy,
  DurableContext,
  JitterStrategy,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { createDualModeOtelSetup } from "../shared/otel-test-setup";

const { plugin, getSerializedSpans, resetExporter } = createDualModeOtelSetup();

export const config: ExampleConfig = {
  name: "OTel Wait for Condition",
  excludeRuntimes: ["24.x"],
};

export { getSerializedSpans, resetExporter };

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
      return {
        finalState,
        mode,
        spans: getSerializedSpans(),
        xRayHeader: process.env._X_AMZN_TRACE_ID,
      };
    }

    if (mode === "exhausted") {
      // Condition never met, exhausts maxAttempts (5)
      let exhaustedError: unknown;
      try {
        await context.waitForCondition(
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
      } catch (error) {
        exhaustedError = error;
      }
      return {
        failed: true,
        errorMessage:
          exhaustedError instanceof Error
            ? exhaustedError.message
            : String(exhaustedError),
        mode,
        spans: getSerializedSpans(),
        xRayHeader: process.env._X_AMZN_TRACE_ID,
      };
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

    return {
      finalState,
      mode,
      spans: getSerializedSpans(),
      xRayHeader: process.env._X_AMZN_TRACE_ID,
    };
  },
  { plugins: [plugin] },
);
