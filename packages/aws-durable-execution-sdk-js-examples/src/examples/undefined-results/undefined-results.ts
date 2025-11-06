import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";

export const config: ExampleConfig = {
  name: "Undefined Results",
  description:
    "Demonstrates handling of operations that return undefined values during replay",
};

export const handler = withDurableExecution(
  async (event: unknown, context: DurableContext) => {
    await context.step("fetch-user", () => Promise.resolve(undefined));

    await context.runInChildContext("parent", () => Promise.resolve(undefined));

    await context.wait({ seconds: 1 });

    return "result";
  },
);
