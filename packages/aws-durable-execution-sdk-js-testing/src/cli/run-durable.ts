#!/usr/bin/env node
import { LocalDurableTestRunner } from "../test-runner/local";
import { pathToFileURL } from "url";
import { resolve } from "path";
import type {
  LambdaHandler,
  DurableExecutionInvocationInput,
} from "@aws/durable-execution-sdk-js";

async function runDurable() {
  const args = process.argv.slice(2);
  const filePath = args[0];
  const skipTime = args[1] !== "no-skip-time";
  const verbose = args[2] === "verbose";
  const showHistory = args[3] === "show-history";

  if (!filePath) {
    console.log(
      "Usage: run-durable <path-to-handler-file> [no-skip-time] [verbose] [show-history]",
    );
    console.log("Example: run-durable ./src/examples/hello-world.ts");
    console.log(
      "Example: run-durable ./src/examples/hello-world.ts no-skip-time",
    );
    console.log(
      "Example: run-durable ./src/examples/hello-world.ts no-skip-time verbose",
    );
    console.log(
      "Example: run-durable ./src/examples/hello-world.ts skip-time no-verbose show-history",
    );
    process.exit(0);
  }

  if (verbose) {
    process.env.DURABLE_VERBOSE_MODE = "true";
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

    await LocalDurableTestRunner.setupTestEnvironment({
      skipTime,
    });

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
    });

    console.log(`Running durable function from: ${filePath}`);
    console.log(
      `Skip time: ${skipTime}, Verbose: ${verbose}, Show history: ${showHistory}\n`,
    );

    const execution = await runner.run();

    execution.print();

    console.log("\nExecution Status:", execution.getStatus());

    if (showHistory) {
      const history = execution.getHistoryEvents();
      console.log("\nHistory Events:");
      console.table(history);
    }

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
