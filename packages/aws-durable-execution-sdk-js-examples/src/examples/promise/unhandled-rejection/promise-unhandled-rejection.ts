import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Promise Unhandled Rejection",
  description:
    "Test that promise combinators don't cause unhandled rejections with comprehensive timing scenarios",
};

export const handler = withDurableExecution(
  async (_event, context: DurableContext) => {
    // Scenario 1: Immediate combinator usage (original test case)
    const failurePromise = context.step(
      "failure-step",
      async () => {
        throw new Error("This step failed");
      },
      {
        retryStrategy: () => ({
          shouldRetry: false,
        }),
      },
    );

    try {
      await context.promise.all([failurePromise]);
    } catch {
      // ignoring error should not fail execution
    }

    await context.wait("wait-after-basic", { seconds: 1 });

    // Scenario 2: Multiple timing patterns
    const step1 = context.step(
      "step1",
      async () => {
        throw new Error("Step 1 failed");
      },
      { retryStrategy: () => ({ shouldRetry: false }) },
    );

    const step2 = context.step(
      "step2",
      async () => {
        throw new Error("Step 2 failed");
      },
      { retryStrategy: () => ({ shouldRetry: false }) },
    );

    // Immediate usage
    try {
      await context.promise.all([step1]);
    } catch {
      // ignoring error should not cause unhandled rejection
    }

    try {
      await context.promise.any([step2]);
    } catch {
      // ignoring error should not cause unhandled rejection
    }

    // Scenario 3: Combinator after operations
    const step3 = context.step(
      "step3",
      async () => {
        throw new Error("Step 3 failed");
      },
      { retryStrategy: () => ({ shouldRetry: false }) },
    );

    const step4 = context.step(
      "step4",
      async () => {
        throw new Error("Step 4 failed");
      },
      { retryStrategy: () => ({ shouldRetry: false }) },
    );

    try {
      await context.promise.all([step3]);
    } catch {
      // ignoring error should not cause unhandled rejection
    }

    await context.wait("wait-middle", { seconds: 1 });

    try {
      await context.promise.any([step4]);
    } catch {
      // ignoring error should not cause unhandled rejection
    }

    // Scenario 4: Combinator after wait (replay scenario)
    const step5 = context.step(
      "step5",
      async () => {
        throw new Error("Step 5 failed");
      },
      { retryStrategy: () => ({ shouldRetry: false }) },
    );

    const step6 = context.step(
      "step6",
      async () => {
        throw new Error("Step 6 failed");
      },
      { retryStrategy: () => ({ shouldRetry: false }) },
    );

    await context.wait("wait-before-final", { seconds: 1 });

    try {
      await context.promise.all([step5]);
    } catch {
      // ignoring error should not cause unhandled rejection in replay
    }

    try {
      await context.promise.any([step6]);
    } catch {
      // ignoring error should not cause unhandled rejection in replay
    }

    // Success step (original test case)
    const successStep = await context.step("success-step", async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return "Success";
    });

    return {
      successStep,
      scenariosTested: [
        "basic-promise-all",
        "immediate-combinator-usage",
        "combinator-after-operations",
        "combinator-after-wait-replay",
      ],
    };
  },
);
