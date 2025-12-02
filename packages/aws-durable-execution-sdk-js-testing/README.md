# AWS Durable Execution Testing SDK for JavaScript

Testing utilities for the AWS Durable Execution SDK for JavaScript and TypeScript.

## Features

This package provides testing tools for durable functions both locally and in the cloud:

- **LocalDurableTestRunner** - Execute and test durable functions locally without AWS deployment
  - **Time-skipping support** - Skip wait operations and delays for faster test execution
  - **Function registration** - Register additional functions for chained invoke testing
  - **Full operation inspection** - Access detailed information about steps, waits, callbacks, and more
  - **Mock-friendly** - Works seamlessly with Jest and other mocking frameworks

- **CloudDurableTestRunner** - Test against deployed AWS Lambda functions
  - **Real environment testing** - Validate behavior against actual your actual deployed AWS Lambda function
  - **Configurable invocation** - Support for different invocation types and polling intervals

- **Testing Capabilities**
  - **Operation assertions** - Inspect individual operations by name, index, or ID
  - **Status and result validation** - Verify execution status, results, and error conditions
  - **Callback testing** - Send callback responses and verify callback behavior
  - **Retry validation** - Test step retry logic and failure scenarios

## Installation

```bash
npm install --save-dev @aws/durable-execution-sdk-js-testing
```

## Quick Start

### Handler Code

```typescript
import {
  withDurableExecution,
  DurableContext,
} from "@aws/durable-execution-sdk-js";

const handler = async (event: any, context: DurableContext) => {
  // Execute a durable step with automatic retry
  const userData = await context.step("fetch-user", async () =>
    fetchUserFromDB(event.userId),
  );

  // Wait for 5 seconds
  await context.wait({ seconds: 5 });

  // Process data in another step
  const result = await context.step("process-user", async () =>
    processUser(userData),
  );

  return result;
};

export const lambdaHandler = withDurableExecution(handler);
```

### Test Code

#### Local Testing

```typescript
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { lambdaHandler } from "./lambdaHandler";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({
    skipTime: true,
  }),
);

afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("LocalDurableTestRunner", () => {
  let runner;

  beforeEach(() => {
    runner = new LocalDurableTestRunner({
      handlerFunction: lambdaHandler,
    });
  });

  it("should wait for 5 seconds and return result", async () => {
    const execution = await runner.run({ payload: { userId: "123" } });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getOperations()).toHaveLength(3); // fetch-user, wait, process-user

    // Check the fetch-user step
    const fetchStep = runner.getOperation("fetch-user");
    await fetchStep.waitForData(WaitingOperationStatus.COMPLETED);
    const fetchDetails = fetchStep.getStepDetails();
    expect(fetchDetails?.result).toBeDefined();

    // Check the wait operation
    const waitOp = runner.getOperationByIndex(1);
    const waitDetails = waitOp.getWaitDetails();
    expect(waitDetails?.waitSeconds).toBe(5);

    // Check the process-user step
    const processStep = runner.getOperation("process-user");
    await processStep.waitForData(WaitingOperationStatus.COMPLETED);
    const processDetails = processStep.getStepDetails();
    expect(processDetails?.result).toBeDefined();
  });
});
```

#### Cloud Testing

```typescript
import {
  CloudDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";

describe("CloudDurableTestRunner", () => {
  let runner;

  beforeEach(() => {
    runner = new CloudDurableTestRunner({
      functionName: "my-durable-function", // Your deployed function name
    });
  });

  it("should wait for 5 seconds and return result", async () => {
    const execution = await runner.run({ payload: { userId: "123" } });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getOperations()).toHaveLength(3); // fetch-user, wait, process-user

    // Check the fetch-user step
    const fetchStep = runner.getOperation("fetch-user");
    const fetchDetails = fetchStep.getStepDetails();
    expect(fetchDetails?.result).toBeDefined();
    expect(fetchDetails?.attempt).toBe(1);

    // Check the wait operation
    const waitOp = runner.getOperationByIndex(1);
    const waitDetails = waitOp.getWaitDetails();
    expect(waitDetails?.waitSeconds).toBe(5);

    // Check the process-user step
    const processStep = runner.getOperation("process-user");
    const processDetails = processStep.getStepDetails();
    expect(processDetails?.result).toBeDefined();
  });
});
```

## Documentation

This README provides a quick reference for the Testing SDK's main features. For more detailed information:

- **[API Reference](../../docs/api-reference/durable-execution-sdk-js-testing.md)** - Complete technical reference with detailed type definitions and operation specifications
- **[Contributing](../../CONTRIBUTING.md)** - Learn about contributing to the AWS Durable Execution Testing SDK for JavaScript

## LocalDurableTestRunner

Run durable functions locally with a simulated durable execution backend.

```typescript
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./my-durable-function";

// Set up test environment with optional time skipping
await LocalDurableTestRunner.setupTestEnvironment({
  skipTime: true, // Skip wait delays for faster tests
});

const runner = new LocalDurableTestRunner({
  handlerFunction: handler,
});

const execution = await runner.run({ payload: { test: "data" } });

// Assert on results
expect(execution.getStatus()).toBe("SUCCEEDED");
expect(execution.getResult()).toEqual(expectedValue);

// Assert on operations
const operations = execution.getOperations();
expect(operations).toHaveLength(3);

// Clean up test environment
await LocalDurableTestRunner.teardownTestEnvironment();
```

### Mocking

Mock external dependencies using Jest or your preferred testing framework:

```typescript
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";

// Mock external functions
jest.mock("../services/userService", () => ({
  fetchUserFromDB: jest.fn(),
  processUser: jest.fn(),
}));

import { fetchUserFromDB, processUser } from "../services/userService";
import { lambdaHandler } from "./lambdaHandler";

const mockFetchUser = fetchUserFromDB as jest.MockedFunction<
  typeof fetchUserFromDB
>;
const mockProcessUser = processUser as jest.MockedFunction<typeof processUser>;

describe("Mocked Dependencies", () => {
  let runner: LocalDurableTestRunner;

  beforeAll(() =>
    LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
  );
  afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

  beforeEach(() => {
    runner = new LocalDurableTestRunner({ handlerFunction: lambdaHandler });

    // Reset mocks
    mockFetchUser.mockClear();
    mockProcessUser.mockClear();
  });

  it("should call mocked functions and return expected results", async () => {
    // Setup mocks
    const userData = { id: "123", name: "John Doe" };
    const processedResult = { id: "123", processed: true };

    mockFetchUser.mockResolvedValue(userData);
    mockProcessUser.mockResolvedValue(processedResult);

    // Run test
    const execution = await runner.run({ payload: { userId: "123" } });

    // Verify results
    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual(processedResult);

    // Verify mock calls
    expect(mockFetchUser).toHaveBeenCalledWith("123");
    expect(mockProcessUser).toHaveBeenCalledWith(userData);

    // Verify operations
    const fetchStep = runner.getOperation("fetch-user");
    const fetchDetails = fetchStep.getStepDetails();
    expect(fetchDetails?.result).toEqual(userData);
  });
});
```

### Function Registration

Register additional functions that can be invoked during local testing of chained invocations:

#### Handler Code

```typescript
const mainHandler = withDurableExecution(async (event, context) => {
  await context.invoke("workflow-a:$LATEST");
  await context.invoke("workflow-b:$LATEST");

  await context.invoke("utility-function");
  await context.invoke("utility-helper");
});
```

#### Test code

```typescript
const runner = new LocalDurableTestRunner({ handlerFunction: mainHandler });

// Register durable functions
runner.registerDurableFunction("workflow-a:$LATEST", durableWorkflowA);

// Register regular functions
runner.registerFunction("utility-function", utilityHandler);

// Method chaining is supported
runner
  .registerDurableFunction("workflow-b:$LATEST", durableWorkflowB)
  .registerFunction("helper", helperHandler);
```

## CloudDurableTestRunner

Test against deployed Lambda functions in AWS.

```typescript
import {
  CloudDurableTestRunner,
  InvocationType,
} from "@aws/durable-execution-sdk-js-testing";
import { LambdaClient } from "@aws-sdk/client-lambda";

const runner = new CloudDurableTestRunner({
  functionName: "MyDurableFunction",
  client: new LambdaClient({ region: "us-east-1" }), // optional
  config: {
    pollInterval: 1000, // optional, default 1000ms
    invocationType: InvocationType.RequestResponse, // optional
  },
});

const execution = await runner.run({ payload: { userId: "123" } });

expect(execution.getStatus()).toBe("SUCCEEDED");
```

## Test Result API

Both runners return a `TestResult` object with methods for assertions:

```typescript
const execution = await runner.run();

// Get execution status and results
execution.getStatus(); // "SUCCEEDED" | "FAILED" | "RUNNING" | etc.
execution.getResult(); // Returns the function result
execution.getError(); // Returns error details if failed

// Get operations
execution.getOperations(); // All operations
execution.getOperations({ status: "SUCCEEDED" }); // Filter by status

// Get execution history and invocations
execution.getHistoryEvents(); // Detailed event history
execution.getInvocations(); // Handler invocation details

// Print operations table to console
execution.print(); // Default columns
execution.print({ name: true, status: true, duration: true }); // Custom columns
```

## Operation Assertions

Access specific operations for detailed assertions:

```typescript
// Get operations by different methods
const operation = runner.getOperation("my-step"); // By name
const firstOp = runner.getOperationByIndex(0); // By execution order
const secondNamedOp = runner.getOperationByNameAndIndex("my-step", 1); // By name + index
const opById = runner.getOperationById("abc123"); // By unique ID

// Wait for operation data to be available
await operation.waitForData(); // Default to STARTED status
await operation.waitForData(WaitingOperationStatus.COMPLETED);

// Get operation details based on type
const stepDetails = operation.getStepDetails(); // For step operations
const contextDetails = operation.getContextDetails(); // For context operations
const callbackDetails = operation.getCallbackDetails(); // For callback operations
const waitDetails = operation.getWaitDetails(); // For wait operations

// Get basic operation information
operation.getName();
operation.getStatus();
operation.getStartTimestamp();
operation.getEndTimestamp();
```

### Callback Operations

For callback operations, you can send responses:

```typescript
const callback = runner.getOperation("my-callback");
await callback.waitForData(WaitingOperationStatus.SUBMITTED);

// Send callback responses
await callback.sendCallbackSuccess("result data");
await callback.sendCallbackFailure({ errorMessage: "Failed" });
await callback.sendCallbackHeartbeat();
```

## Configuration Options

### LocalDurableTestRunner

```typescript
// Constructor
new LocalDurableTestRunner({ handlerFunction: handler });

// Environment setup
await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });

// Environment teardown
await LocalDurableTestRunner.teardownTestEnvironment();
```

### CloudDurableTestRunner

```typescript
// Basic configuration
new CloudDurableTestRunner({ functionName: "MyFunction:$LATEST" });

// Advanced configuration
new CloudDurableTestRunner({
  functionName: "MyFunction:$LATEST",
  client: new LambdaClient({ region: "us-east-1" }),
  config: { pollInterval: 500, invocationType: InvocationType.Event },
});
```

## Reset Runner State

The `reset()` method is required if you reuse the same runner instance between tests. Data about an individual execution is cleared from the runner instance when `reset()` is called.

```typescript
describe("Reusing Runner Instance", () => {
  let runner: LocalDurableTestRunner;

  beforeAll(() => {
    // Create runner once
    runner = new LocalDurableTestRunner({ handlerFunction: handler });
  });

  beforeEach(() => {
    // Reset state when reusing the same instance
    runner.reset();
  });

  // ... tests
});
```

## Security

See [CONTRIBUTING](../../CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This project is licensed under the Apache-2.0 License.
