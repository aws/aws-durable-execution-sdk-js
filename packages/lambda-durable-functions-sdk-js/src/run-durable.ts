/* eslint-disable no-console */

import { Context } from "aws-lambda";
import { withDurableFunctions } from "./with-durable-functions";
import { resolve } from "path";
import { DurableExecutionInvocationInput } from "./types";

// Set verbose mode for local testing
process.env.DURABLE_VERBOSE_MODE = "true";

async function runHandler(
  handlerPath: string,
  lambdaRequestJson?: string,
): Promise<void> {
  try {
    // Dynamically import the handler module
    const module = await import(handlerPath);
    const handler = module.default || module.handler;

    if (typeof handler !== "function") {
      throw new Error(
        'Handler must export a function either as default export or named export "handler"',
      );
    }

    // Wrap the handler with durableFunctions
    const wrappedHandler = withDurableFunctions(handler);

    // Create test event
    const event = lambdaRequestJson
      ? (JSON.parse(lambdaRequestJson) as DurableExecutionInvocationInput)
      : {
          CheckpointToken: "initial-task-token",
          DurableExecutionArn: `invocation-${Date.now()}`,
          InitialExecutionState: {
            Operations: [],
            NextMarker: "",
          },
        };

    // Execute the handler
    console.log("Starting execution...\n");
    console.log("Using durableExecutionArn:", event.DurableExecutionArn);
    const result = await wrappedHandler(event, {} as Context);
    console.log("\nExecution completed.");
    console.log("Result:", result);
  } catch (error) {
    console.error("Execution failed:", error);
    process.exit(1);
  }
}

// Get the handler path and invocationId from command line arguments
const [handlerPath, lambdaRequest] = process.argv.slice(2);

if (!handlerPath) {
  console.error("Please provide the handler file path");
  process.exit(1);
}

// Convert relative path to absolute
const projectRoot = resolve(__dirname, ".."); // Go up one level from src
const absolutePath = resolve(projectRoot, handlerPath);

// Run the handler with optional invocationId
runHandler(absolutePath, lambdaRequest);
