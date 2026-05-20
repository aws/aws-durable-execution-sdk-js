import {
  DurableContext,
  withDurableExecution,
  createClassSerdes,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Configure Default Serdes via configureSerdes",
  description:
    "Demonstrates using context.configureSerdes() to set a default serdes once " +
    "that applies to all step operations, instead of passing serdes per-operation.",
};

class Order {
  id: string = "";
  amount: number = 0;
  status: string = "pending";

  constructor(id?: string, amount?: number) {
    if (id) this.id = id;
    if (amount !== undefined) this.amount = amount;
  }

  summary(): string {
    return `Order ${this.id}: $${this.amount} (${this.status})`;
  }
}

export const handler = withDurableExecution(
  async (
    event: { orderId: string; amount: number },
    context: DurableContext,
  ) => {
    // Configure default serdes once — applies to all subsequent steps
    const orderSerdes = createClassSerdes(Order);
    context.configureSerdes({ defaultSerdes: orderSerdes });

    // Step 1: no per-step serdes needed — uses the configured default
    const order = await context.step("create-order", async () => {
      return new Order(event.orderId, event.amount);
    });

    // Wait forces a replay — order will be deserialized using orderSerdes
    await context.wait({ seconds: 1 });

    // Step 2: order.summary() works because class methods were preserved by the default serdes
    const processed = await context.step("process-order", async () => {
      order.status = "processed";
      return order;
    });

    return {
      summary: processed.summary(),
      id: processed.id,
      amount: processed.amount,
      status: processed.status,
    };
  },
);
