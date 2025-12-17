import { LocalDurableTestRunner } from "../../index";
import { parseCliArgs } from "./utils/cli-config";
import {
  validateFilePath,
  loadAndValidateHandler,
  setupEnvironment,
} from "./utils/validation";
import { logExecutionStart, logExecutionResults } from "./utils/output";

export class RunDurableError extends Error {}

export async function runDurable() {
  // Parse CLI arguments
  const { filePath, options } = parseCliArgs();

  try {
    // Validate file and load handler
    const absolutePath = validateFilePath(filePath);
    const handler = await loadAndValidateHandler(
      absolutePath,
      options.handlerExport,
      filePath,
    );

    // Set up environment
    setupEnvironment(options.verbose);

    // Set up test environment
    await LocalDurableTestRunner.setupTestEnvironment({
      skipTime: options.skipTime,
    });

    // Create runner and execute
    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
    });

    // Log execution start
    logExecutionStart({
      filePath,
      skipTime: options.skipTime,
      verbose: options.verbose,
      showHistory: options.showHistory,
    });

    // Run execution
    const execution = await runner.run();

    // Log results
    logExecutionResults(execution, options.showHistory);

    // Clean up
    await LocalDurableTestRunner.teardownTestEnvironment();
  } catch (err: unknown) {
    if (err instanceof Error && !options.verbose) {
      throw new RunDurableError(err.message);
    }
    throw err;
  }
}
