import {
  DurableContext,
  StepSemantics,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Step Default Semantics",
  description:
    "Sets AtLeastOnceAsync as the default step semantics, and keeps AtLeastOnce for a step whose result is an idempotency key",
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    // Uses the execution default, AtLeastOnceAsync. The step returns without waiting for
    // its result to be saved.
    const quantity = await context.step("count-items", async () => 3);

    // The order ID is an idempotency key for later steps. So it must be saved before
    // they run, and the step sets AtLeastOnce itself.
    const orderId = await context.step(
      "create-order-id",
      async () => `order-${quantity}`,
      { semantics: StepSemantics.AtLeastOnce },
    );

    // The wait ends the invocation. The next invocation replays the saved results.
    await context.wait("wait-for-warehouse", { seconds: 1 });

    return await context.step(
      "confirm-order",
      async () => `${orderId} confirmed`,
    );
  },
  { defaultStepSemantics: StepSemantics.AtLeastOnceAsync },
);
