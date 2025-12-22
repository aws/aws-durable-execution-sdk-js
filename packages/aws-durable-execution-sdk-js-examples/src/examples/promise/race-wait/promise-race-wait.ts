import {
  withDurableExecution,
  DurableContext,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Promise Race With Wait",
  description: "Waiting for a promise race to complete with multiple waits",
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const before = await context.step(() => Promise.resolve(Date.now()));
    await context.promise.race([
      context.wait("wait-1", { seconds: 1 }),
      context.wait("wait-2", { seconds: 10 }),
    ]);
    const after = await context.step(() => Promise.resolve(Date.now()));
    return after - before;
  },
);
