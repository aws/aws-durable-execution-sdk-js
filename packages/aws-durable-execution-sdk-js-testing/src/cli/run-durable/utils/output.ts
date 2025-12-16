import { TestResult } from "../../../test-runner";

export interface ExecutionOptions {
  filePath: string;
  skipTime: boolean;
  verbose: boolean;
  showHistory: boolean;
}

/**
 * Log execution configuration
 */
export function logExecutionStart(options: ExecutionOptions): void {
  console.log(`Running durable function from: ${options.filePath}`);
  console.log(
    `Skip time: ${options.skipTime}, Verbose: ${options.verbose}, Show history: ${options.showHistory}\n`,
  );
}

/**
 * Log execution results
 */
export function logExecutionResults(
  execution: TestResult,
  showHistory: boolean,
): void {
  execution.print();
  console.log("\nExecution Status:", execution.getStatus());

  if (showHistory) {
    const history = execution.getHistoryEvents();
    console.log("\nHistory Events:");
    console.table(history);
  }

  try {
    const result = execution.getResult() as unknown;
    console.log("\nResult:");
    console.log(JSON.stringify(result, null, 2));
  } catch {
    const err = execution.getError();
    console.log("\nError:");
    console.log(JSON.stringify(err, null, 2));
  }
}
