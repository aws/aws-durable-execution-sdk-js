import {
  CallbackError,
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait for Callback - Error Instance Failure",
  description: "Verifies CallbackError instanceof check works across replays",
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    let error: Error | null = null;

    try {
      await context.waitForCallback(
        "failure-test",
        async () => Promise.resolve(),
        { timeout: { seconds: 10 } },
      );
    } catch (e) {
      error = e as Error;
    }

    await context.wait({ seconds: 1 });

    return await context.step("check-error-type", async () => ({
      isCallbackError: error instanceof CallbackError,
      errorName: error?.constructor.name,
      errorMessage: error?.message,
    }));
  },
);
