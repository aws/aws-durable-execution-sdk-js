#!/usr/bin/env node
import { LocalDurableTestRunner } from "../test-runner/local";
import { pathToFileURL } from "url";
import { resolve } from "path";
import type {
  LambdaHandler,
  DurableExecutionInvocationInput,
} from "@aws/durable-execution-sdk-js";

async function runDurable() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: run-durable <path-to-handler-file>");
    console.error("Example: run-durable ./src/examples/hello-world.ts");
    process.exit(1);
  }

  // Use ORIGINAL_CWD if set (from root npm script), otherwise use INIT_CWD (npm's original dir), fallback to cwd
  const basePath =
    process.env.ORIGINAL_CWD ?? process.env.INIT_CWD ?? process.cwd();
  const absolutePath = resolve(basePath, filePath);
  const fileUrl = pathToFileURL(absolutePath).href;

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const module: { handler?: unknown; default?: unknown } = await import(
      fileUrl
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const handler = (module.handler ??
      module.default) as LambdaHandler<DurableExecutionInvocationInput>;

    await LocalDurableTestRunner.setupTestEnvironment();

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    console.log(`Running durable function from: ${filePath}\n`);

    const execution = await runner.run();

    execution.print();

    console.log("\nExecution Status:", execution.getStatus());

    try {
      const result = execution.getResult();
      console.log("\nResult:");
      console.log(JSON.stringify(result, null, 2));
    } catch {
      const err = execution.getError();
      console.log("\nError:");
      console.log(JSON.stringify(err, null, 2));
    }

    await LocalDurableTestRunner.teardownTestEnvironment();
  } catch (error) {
    console.error("Error running durable function:", error);
    process.exit(1);
  }
}

void runDurable();
