import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Empty Parallel",
  description: "Running parallel with an empty array of operations",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.parallel("empty-parallel", []);

    await context.wait({ seconds: 1 });

    return {
      results: result.getResults(),
      errors: result.getErrors(),
      successCount: result.successCount,
      failureCount: result.failureCount,
      totalCount: result.totalCount,
      status: result.status,
      completionReason: result.completionReason,
    };
  },
);
