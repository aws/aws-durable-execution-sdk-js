import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Step attempt-based fallback",
  description:
    "Uses stepContext.attempt (1-based) to try suppliers in preference order: " +
    "each retry advances to the next supplier until one can fulfill the order.",
};

// Suppliers in preference order. In this example only the last one has stock,
// so the step fails over from one supplier to the next on each retry.
const SUPPLIERS = ["supplier-a", "supplier-b", "supplier-c"];

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const order = await context.step(
      "place-backorder",
      async (stepCtx) => {
        // attempt is 1-based: attempt 1 -> first supplier, attempt 2 -> second, ...
        const supplier = SUPPLIERS[stepCtx.attempt - 1];
        stepCtx.logger.info("Attempting to place backorder", {
          supplier,
          attempt: stepCtx.attempt,
        });

        if (supplier == null) {
          throw new Error("No suppliers left to try");
        }
        // Only the last supplier can fulfill the order in this example.
        if (supplier !== SUPPLIERS[SUPPLIERS.length - 1]) {
          throw new Error(`${supplier} is out of stock`);
        }

        return { supplier, attempt: stepCtx.attempt, status: "backordered" };
      },
      {
        // Retry only while suppliers remain. The cloud checkpoint API requires
        // a retry delay of at least 1 second, so we use the minimum.
        retryStrategy: (_error: Error, attemptCount: number) => ({
          shouldRetry: attemptCount < SUPPLIERS.length,
          delay: { seconds: 1 },
        }),
      },
    );

    return order;
  },
);
