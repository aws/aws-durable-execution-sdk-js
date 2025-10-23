# Durable Execution Testing SDK

Testing utilities for AWS Durable Execution SDK for JavaScript/TypeScript.

## Overview

This package provides tools for testing durable functions both locally and in the cloud:

- **LocalDurableTestRunner** - Execute and test durable functions locally without AWS deployment
- **CloudDurableTestRunner** - Test against deployed Lambda functions in AWS
- **run-durable CLI** - Command-line tool for quick local testing
- **Test helpers** - Utilities for assertions and test setup

## LocalDurableTestRunner

Run durable functions locally with a simulated checkpoint server.

```typescript
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./my-durable-function";

await LocalDurableTestRunner.setupTestEnvironment();

const runner = new LocalDurableTestRunner({
  handlerFunction: handler,
  skipTime: true, // Skip wait delays for faster tests
});

const execution = await runner.run();

// Assert on results
expect(execution.getStatus()).toBe("SUCCEEDED");
expect(execution.getResult()).toEqual(expectedValue);

// Assert on operations
const operations = execution.getOperations();
expect(operations).toHaveLength(3);

await LocalDurableTestRunner.teardownTestEnvironment();
```

## CloudDurableTestRunner

Test against deployed Lambda functions in AWS.

```typescript
import { CloudDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";

const runner = new CloudDurableTestRunner({
  functionName: "MyDurableFunction",
  region: "us-east-1",
});

const execution = await runner.run({ payload: { userId: "123" } });

expect(execution.getStatus()).toBe("SUCCEEDED");
```

## run-durable CLI

Quick command-line tool for testing durable functions locally without writing test code.

**See [RUN_DURABLE_CLI.md](./RUN_DURABLE_CLI.md) for complete CLI documentation.**

```bash
# Basic usage
npm run run-durable -- <path-to-handler-file>

# With options
npm run run-durable -- <path-to-handler-file> [no-skip-time] [verbose] [show-history]
```

## Test Result API

Both runners return a `TestResult` object with methods for assertions:

```typescript
const execution = await runner.run();

// Get execution status
execution.getStatus(); // "SUCCEEDED" | "FAILED" | "RUNNING" | etc.

// Get result or error
execution.getResult(); // Returns the function result
execution.getError(); // Returns error details if failed

// Get operations
execution.getOperations(); // All operations
execution.getOperations({ status: "SUCCEEDED" }); // Filter by status

// Get history events
execution.getHistoryEvents(); // Detailed event history

// Get invocations
execution.getInvocations(); // All handler invocations

// Print operations table
execution.print(); // Console table of operations
```

## Operation Assertions

Access specific operations for detailed assertions:

```typescript
// By name
const operation = runner.getOperation("my-step");

// By index
const firstOp = runner.getOperationByIndex(0);

// By name and index
const secondNamedOp = runner.getOperationByNameAndIndex("my-step", 1);

// By ID
const opById = runner.getOperationById("abc123");
```

## Configuration Options

### LocalDurableTestRunner Options

```typescript
{
  handlerFunction: LambdaHandler;  // Required: The durable function handler
  skipTime?: boolean;              // Optional: Skip wait delays (default: false)
}
```

### CloudDurableTestRunner Options

```typescript
{
  functionName: string;     // Required: Lambda function name or ARN
  region?: string;          // Optional: AWS region
  invocationType?: string;  // Optional: 'RequestResponse' | 'Event'
}
```

## Example Test

```typescript
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "../my-function";

describe("My Durable Function", () => {
  beforeAll(async () => {
    await LocalDurableTestRunner.setupTestEnvironment();
  });

  afterAll(async () => {
    await LocalDurableTestRunner.teardownTestEnvironment();
  });

  it("should complete successfully", async () => {
    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    const execution = await runner.run({ payload: { test: "data" } });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({ success: true });
    expect(execution.getOperations()).toHaveLength(2);
  });
});
```

## Security

See [CONTRIBUTING](../../CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This project is licensed under the Apache-2.0 License.
