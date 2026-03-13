import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Tenant Target",
  description:
    "Target function for tenant isolation testing - supports tenant ID invocation",
  durableConfig: {
    ExecutionTimeout: 300,
    RetentionPeriodInDays: 7,
  },
};

export const handler = withDurableExecution(
  async (event: { seconds?: number }, context: DurableContext) => {
    const waitTime = event.seconds || 1;

    await context.wait("tenant-wait", { seconds: waitTime });

    return "wait finished";
  },
);
