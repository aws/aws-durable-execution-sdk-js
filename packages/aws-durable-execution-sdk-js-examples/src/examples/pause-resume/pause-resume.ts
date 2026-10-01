import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";

export const config: ExampleConfig = {
  name: "Pause and Resume",
  description:
    "An order workflow used to show LocalDurableTestRunner.pauseExecution() and " +
    "resumeExecution(). Pausing answers the running invocation's next checkpoint " +
    "without a checkpoint token, so the SDK suspends it with PENDING, and no " +
    "invocation starts again until the execution is resumed.",
  // localOnly: pausing is implemented by the local checkpoint server, which withholds
  // checkpoint tokens on request. The service offers no call to do that, so
  // CloudDurableTestRunner rejects pauseExecution() as not implemented and there is
  // nothing to run against a deployed function.
  localOnly: true,
};

/** How long "reserve-stock" takes, standing in for a slow downstream call. */
export const RESERVE_STOCK_DURATION_MS = 200;

export const handler = withDurableExecution(
  async (event: { orderId?: string }, context: DurableContext) => {
    const orderId = event.orderId ?? "order-1";

    // Slow enough that a test can pause while it runs. The pause takes effect when this
    // step checkpoints its result: that checkpoint is kept, but the invocation stops there.
    const reservation = await context.step("reserve-stock", async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, RESERVE_STOCK_DURATION_MS),
      );
      return `reserved-${orderId}`;
    });

    const approval = await context.waitForCallback<string>(
      "manager-approval",
      async () => {
        // In a real workflow, the callback ID would be sent to an approver here.
      },
    );

    const shipment = await context.step(
      "ship-order",
      async () => `shipped-${orderId}`,
    );

    return { reservation, approval, shipment };
  },
);
