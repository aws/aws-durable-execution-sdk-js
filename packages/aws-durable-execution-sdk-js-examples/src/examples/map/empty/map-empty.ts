import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Empty Map",
  description: "Running map with an empty array of items",
};

export const handler = withDurableExecution(async (event, context) => {
  const result = await context.map("empty-map", [], (mapContext, item) => {
    return item;
  });

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
});
