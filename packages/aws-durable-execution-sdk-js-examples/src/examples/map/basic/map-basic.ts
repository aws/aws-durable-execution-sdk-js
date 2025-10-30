import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Basic Map",
  description: "Processing arrays with concurrent operations",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const items = [1, 2, 3, 4, 5];

    const results = await context.map(
      "map",
      items,
      async (context: DurableContext, item: number, index: number) => {
        return await context.step(async () => {
          return item * 2;
        });
      },
      {
        maxConcurrency: 2,
      },
    );

    // context.wait() terminates the current execution and restarts it later,
    // ensuring getResults() functions correctly during workflow replay
    await context.wait(1);

    return results.getResults();
  },
);
