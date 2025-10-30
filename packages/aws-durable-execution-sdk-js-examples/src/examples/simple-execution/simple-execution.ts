import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";

export const config: ExampleConfig = {
  name: "Simple Execution",
  description: "Demonstrates handler execution without any durable operations",
};

export const handler = withDurableExecution(async (event: unknown) => {
  return Promise.resolve({
    received: JSON.stringify(event),
    timestamp: Date.now(),
    message: "Handler completed successfully",
  });
});
