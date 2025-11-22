import {
  DurableContext,
  StepConfig,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { log } from "../../../utils/logger";

export const config: ExampleConfig = {
  name: "Promise Combinators",
  description: "Complex promise combinator example",
};

interface PromiseCombinatorsInput {
  message?: string;
}

const stepConfig: StepConfig<any> = {
  retryStrategy: (_error, attemptCount) => {
    return {
      shouldRetry: attemptCount < 3,
      delay: { seconds: 1 },
    };
  },
};

/**
 * Example demonstrating promise combinators:
 * - context.promise.all: Wait for all promises to complete
 * - context.promise.race: Get the first promise to complete
 * - context.promise.allSettled: Wait for all promises regardless of success/failure
 * - context.promise.any: Get the first successful promise
 *
 */
export const handler = withDurableExecution(
  async (event: PromiseCombinatorsInput, context: DurableContext) => {
    log("Starting promise combinators example with event:", event);

    // Create some durable steps that return promises
    const step1Promise = context.step("step1", async () => {
      log("Step 1 executing");
      await new Promise((resolve) => setTimeout(resolve, 100)); // Simulate async work
      return "Result from step 1";
    });

    const step2Promise = context.step("step2", async () => {
      log("Step 2 executing");
      await new Promise((resolve) => setTimeout(resolve, 200)); // Simulate async work
      return "Result from step 2";
    });

    const step3Promise = context.step("step3", async () => {
      log("Step 3 executing");
      await new Promise((resolve) => setTimeout(resolve, 50)); // Simulate async work
      return "Result from step 3";
    });

    // Example 1: Promise.all - wait for all promises to complete
    log("Testing Promise.all...");
    const allResults = await context.promise.all("all-steps", [
      step1Promise,
      step2Promise,
      step3Promise,
    ]);
    log("All results:", allResults);

    // Example 2: Promise.race - get the first promise to complete
    log("Testing Promise.race...");
    const step4Promise = context.step("step4", async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return "Slow result";
    });

    const step5Promise = context.step("step5", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "Fast result";
    });

    const raceResult = await context.promise.race([step4Promise, step5Promise]);
    log("Race result:", raceResult);

    // Example 3: Promise.allSettled - wait for all promises regardless of success/failure
    log("Testing Promise.allSettled...");
    const successPromise = context.step("success-step", async () => {
      return "Success!";
    });

    const failurePromise = context.step(
      "failure-step",
      async () => {
        throw new Error("This step failed");
      },
      stepConfig,
    );

    const settledResults = await context.promise.allSettled("settled-steps", [
      successPromise,
      failurePromise,
    ]);
    log("Settled results:", settledResults);

    // Example 4: Promise.any - get the first successful promise
    log("Testing Promise.any...");
    const failPromise1 = context.step(
      "fail1",
      async () => {
        throw new Error("First failure");
      },
      stepConfig,
    );

    const failPromise2 = context.step(
      "fail2",
      async () => {
        throw new Error("Second failure");
      },
      stepConfig,
    );

    const successPromise2 = context.step("success2", async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return "First success!";
    });

    let anyResult;
    try {
      anyResult = await context.promise.any([
        failPromise1,
        failPromise2,
        successPromise2,
      ]);
      log("Any result:", anyResult);
    } catch (error) {
      log("All promises failed:", error);
      anyResult = "All promises failed";
    }

    return {
      message: "Promise combinators example completed successfully",
      allResults,
      raceResult,
      settledResults,
      anyResult,
    };
  },
);
