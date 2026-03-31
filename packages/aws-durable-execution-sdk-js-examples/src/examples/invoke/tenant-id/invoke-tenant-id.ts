import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Invoke Tenant Id",
  description:
    "Demonstrates invoking a tenant-isolated Lambda function using tenantId",
};

export const handler = withDurableExecution(
  async (
    event: {
      functionName: string;
      tenantId: string;
      payload?: Record<string, unknown>;
    },
    context: DurableContext,
  ) => {
    const result = await context.invoke(event.functionName, event.payload, {
      tenantId: event.tenantId,
    });
    return result;
  },
);
