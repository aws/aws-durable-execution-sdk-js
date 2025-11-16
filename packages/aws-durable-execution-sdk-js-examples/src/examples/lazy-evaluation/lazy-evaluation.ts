import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";

export const config: ExampleConfig = {
  name: "Lazy Evaluation",
  description:
    "Demonstrates that durable operations are lazily evaluated - no operations are created until promises are awaited",
};

export const handler = withDurableExecution(
  async (_event, context: DurableContext) => {
    context.logger.info("Starting lazy-evaluation handler");

    // Create promises for various operations but DON'T await them yet
    // If promises are lazy, these should not create operations until awaited

    // Step operations
    const stepPromise1 = context.step("step-operation-1", async () => {
      return "Step 1 result";
    });

    const stepPromise2 = context.step("step-operation-2", async () => {
      return "Step 2 result";
    });

    context.logger.info("Created step promises - should be lazy");

    // Wait operation
    const waitPromise = context.wait("wait-operation", { seconds: 1 });

    context.logger.info("Created wait promise - should be lazy");

    // Parallel operation
    const parallelPromise = context.parallel("parallel-operation", [
      async () => "Parallel task 1",
      async () => "Parallel task 2",
    ]);

    context.logger.info("Created parallel promise - should be lazy");

    // Map operation
    const mapPromise = context.map(
      "map-operation",
      [1, 2, 3],
      async (item) => `Mapped item: ${item}`,
    );

    // Promise combinator operations
    const promiseAllPromise = context.promise.all([
      context.step("promise-all-step-1", async () => "All step 1"),
      context.step("promise-all-step-2", async () => "All step 2"),
    ]);

    const promiseRacePromise = context.promise.race([
      context.step("promise-race-step-1", async () => "Race step 1"),
      context.step("promise-race-step-2", async () => "Race step 2"),
    ]);

    const promiseAllSettledPromise = context.promise.allSettled([
      context.step(
        "promise-allsettled-step-1",
        async () => "AllSettled step 1",
      ),
      context.step(
        "promise-allsettled-step-2",
        async () => "AllSettled step 2",
      ),
    ]);

    // Wait-for-callback operation with proper submitter function
    const callbackSubmitter = async (callbackId: string): Promise<void> => {
      // In a real scenario, this would call an external service
      // For testing, we'll just log the callback ID
      console.log(`Callback ID: ${callbackId}`);
    };

    const waitForCallbackPromise = context.waitForCallback(
      "callback-operation",
      callbackSubmitter,
      { timeout: { seconds: 5 } },
    );

    // Run-in-child-context operation
    const childContextPromise = context.runInChildContext(
      "child-context-operation",
      async (childContext) => {
        const childStep = await childContext.step("child-step", async () => {
          return "Child step result";
        });
        return { childResult: childStep };
      },
    );

    // Do an in-process wait for 500ms to make sure no operations get created (not a durable wait)
    await new Promise((resolve) => setTimeout(resolve, 500));

    context.logger.info(
      "About to await wait-1 - this should create the only durable operation",
    );

    // Only one operation should exist, and on replay nothing should get created still
    await context.wait("wait-1", { seconds: 1 });

    context.logger.info("Completed wait-1 - lazy evaluation test should pass");

    // Do another in-process wait after the operation for 500ms to make sure no operations get created
    await new Promise((resolve) => setTimeout(resolve, 500));

    context.logger.info("Handler completed successfully");
  },
);
