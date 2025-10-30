import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";

export const config: ExampleConfig = {
  name: "Handler Error",
  description:
    "Demonstrates how handler-level errors are captured and structured in results",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    // Simulate a handler-level error that might occur in real applications
    throw new Error("Intentional handler failure");
  },
);
