import {
  CallbackTimeoutError,
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait for Callback - Error Instance Timeout",
  description:
    "Verifies CallbackTimeoutError instanceof check works across replays",
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    let error: Error | null = null;

    try {
      await context.waitForCallback(
        "timeout-test",
        async () => Promise.resolve(),
        { timeout: { seconds: 1 } },
      );
    } catch (e) {
      error = e as Error;
    }

    await context.wait({ seconds: 1 });

    return await context.step("check-error-type", async () => ({
      isCallbackTimeoutError: error instanceof CallbackTimeoutError,
      errorName: error?.constructor.name,
      errorMessage: error?.message,
    }));
  },
);
