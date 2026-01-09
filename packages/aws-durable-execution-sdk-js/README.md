# AWS Durable Execution SDK for JavaScript

TypeScript SDK for building stateful, long-running AWS Lambda functions with automatic state persistence, retry logic, and workflow orchestration.

## Features

- **Durable Execution**: Automatically persists state and resumes from checkpoints
- **Automatic Retries**: Configurable retry strategies with exponential backoff and jitter
- **Workflow Orchestration**: Compose complex workflows with steps, child contexts, and parallel execution
- **External Integration**: Wait for callbacks from external systems
- **Batch Operations**: Process arrays with concurrency control and completion policies
- **Type Safety**: Full TypeScript support with comprehensive type definitions

## Installation

```bash
npm install @aws/durable-execution-sdk-js
```

## Quick Start

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

## Documentation

This README provides a quick reference for the SDK's main features. For more detailed information:

- **[API Reference](../../docs/api-reference/durable-execution-sdk-js.md)** - Complete technical reference with detailed type definitions and operation specifications
- **[Concepts and Use Cases](src/documents/CONCEPTS.md)** - Learn about the replay model, best practices, and real-world examples including GenAI agents, human-in-the-loop workflows, and saga patterns
- **[Contributing](../../CONTRIBUTING.md)** - Learn about contributing to the AWS Durable Execution SDK for JavaScript

## Core Concepts

### DurableContext

The `DurableContext` is the main interface for building durable workflows. It provides methods for executing steps, waiting, invoking other functions, and coordinating parallel operations.

### Step Operations

Execute atomic operations with automatic retry and state persistence:

```typescript
// Named step with retry configuration
const result = await context.step(
  "fetch-data",
  async (ctx) => {
    return await fetchFromAPI();
  },
  {
    retryStrategy: (error, attempt) => ({
      shouldRetry: attempt < 3,
      delay: { seconds: Math.pow(2, attempt) },
    }),
  },
);

// Anonymous step
const data = await context.step(async () => processData());
```

**Important**: `step()` is for single atomic operations only. To group multiple durable operations, use `runInChildContext()`.

### Child Contexts

Group multiple durable operations with isolated state tracking:

```typescript
const orderResult = await context.runInChildContext(
  "process-order",
  async (childCtx) => {
    // Child context has its own step counter and state
    const validated = await childCtx.step("validate", async () =>
      validateOrder(order),
    );
    await childCtx.wait({ seconds: 1 });
    const charged = await childCtx.step("charge", async () =>
      chargePayment(validated),
    );
    return charged;
  },
);
```

### Invoking Other Functions

Call another AWS Lambda function and wait for it complete:

```typescript
const result = await context.invoke(
  "process-payment",
  "arn:aws:lambda:us-east-1:123456789012:function:payment-processor",
  { amount: 100, currency: "USD" },
);
```

### Wait Operations

Pause execution for a specified duration:

```typescript
// Wait 30 seconds
await context.wait({ seconds: 30 });

// Named wait for tracking
await context.wait("rate-limit-delay", { seconds: 5 });
```

### Conditional Waiting

Wait until a condition is met by periodically checking state:

```typescript
const finalState = await context.waitForCondition(
  "wait-for-job",
  async (currentState, ctx) => {
    const status = await checkJobStatus(currentState.jobId);
    return { ...currentState, status };
  },
  {
    initialState: { jobId: "job-123", status: "pending" },
    waitStrategy: (state, attempt) => {
      if (state.status === "completed") {
        return { shouldContinue: false };
      }
      return {
        shouldContinue: true,
        delay: { seconds: Math.min(attempt * 2, 60) },
      };
    },
  },
);
```

### External Callbacks

Wait for external systems to complete operations:

```typescript
// Create a callback and send ID to external system
const [callbackPromise, callbackId] = await context.createCallback(
  "external-approval",
  { timeout: { minutes: 3 } },
);

await sendApprovalRequest(callbackId, requestData);
const approvalResult = await callbackPromise;

// Or use waitForCallback with submitter function
const result = await context.waitForCallback(
  "wait-for-webhook",
  async (callbackId, ctx) => {
    await submitToExternalAPI(callbackId);
  },
  { timeout: { minutes: 5 } },
);
```

## Batch Operations

### Map

Process arrays of items, applying durable operations to each with concurrency control:

```typescript
const results = await context.map(
  "process-users",
  users,
  async (ctx, user, index) => {
    return await ctx.step(`process-${user.id}`, async () => processUser(user));
  },
  {
    maxConcurrency: 5,
    completionConfig: {
      minSuccessful: 8,
      toleratedFailureCount: 2,
    },
    itemNamer: (user, index) => `User-${user.id}`,
  },
);

// Check results
console.log(
  `Succeeded: ${results.successCount}, Failed: ${results.failureCount}`,
);
results.throwIfError(); // Throws if any failures
```

**Note**: `map()` executes durable operations (steps, waits, etc.) within the same Lambda invocation using child contexts for isolation. It does not spawn separate Lambda functions.

### Parallel

Execute multiple branches with durable operations in parallel:

```typescript
const results = await context.parallel(
  "parallel-tasks",
  [
    { name: "task1", func: async (ctx) => ctx.step(async () => fetchData1()) },
    { name: "task2", func: async (ctx) => ctx.step(async () => fetchData2()) },
    async (ctx) => ctx.step(async () => fetchData3()),
  ],
  {
    maxConcurrency: 2,
    completionConfig: { minSuccessful: 2 },
  },
);
```

**Note**: `parallel()` executes durable operations within the same Lambda invocation. Each branch runs in its own child context with isolated state tracking.

### Promise Combinators

For fast, in-memory operations (use `map()` or `parallel()` for durable operations):

```typescript
// Wait for all promises
const [user, posts, comments] = await context.promise.all([
  fetchUser(userId),
  fetchPosts(userId),
  fetchComments(userId),
]);

// Race promises
const fastest = await context.promise.race([
  fetchFromPrimary(),
  fetchFromSecondary(),
]);

// Wait for first success
const result = await context.promise.any([
  fetchFromSource1(),
  fetchFromSource2(),
  fetchFromSource3(),
]);

// Wait for all to settle
const results = await context.promise.allSettled([operation1(), operation2()]);
```

**Note**: Promise combinators accept already-executing promises and cannot provide concurrency control or durability. Use `map()` or `parallel()` for durable, controlled execution.

## Configuration

### Retry Strategies

Custom retry strategy:

```typescript
await context.step("custom-retry", async () => riskyOperation(), {
  retryStrategy: (error, attempt) => ({
    shouldRetry: attempt < 5 && error.message.includes("timeout"),
    delay: { seconds: attempt * 2 },
  }),
});
```

### Step Semantics

Control execution guarantees:

```typescript
import { StepSemantics } from "@aws/durable-execution-sdk-js";

// At-least-once per retry (default)
await context.step("retriable-operation", async () => sendNotification(), {
  semantics: StepSemantics.AtLeastOncePerRetry,
});

// At-most-once per retry
await context.step("idempotent-operation", async () => updateDatabase(), {
  semantics: StepSemantics.AtMostOncePerRetry,
});
```

**Important**: These semantics apply _per retry_, not per overall execution:

- **AtLeastOncePerRetry**: The step will execute at least once on each retry attempt. If the step succeeds but the checkpoint fails (e.g., sandbox crash), the step will re-execute on replay.
- **AtMostOncePerRetry**: The step will execute at most once per retry attempt. A checkpoint is created before execution, so if a failure occurs after the checkpoint but before step completion, the previous step retry attempt is skipped on replay.

**To achieve at-most-once semantics on a step-level**, use a custom retry strategy:

```typescript
await context.step(
  "truly-once-only",
  async () => callThatCannotTolerateDuplicates(),
  {
    semantics: StepSemantics.AtMostOncePerRetry,
    retryStrategy: () => ({ shouldRetry: false }), // No retries
  },
);
```

Without this, a step using `AtMostOncePerRetry` with retries enabled could still execute multiple times across different retry attempts.

### Jitter Strategies

Prevent thundering herd:

```typescript
import {
  JitterStrategy,
  createRetryStrategy,
} from "@aws/durable-execution-sdk-js";

const retryStrategy = createRetryStrategy({
  maxAttempts: 5,
  initialDelay: { seconds: 1 },
  maxDelay: { seconds: 60 },
  exponentialDelayFactor: 2,
  jitterStrategy: JitterStrategy.FULL,
});
```

## Logging

Access enriched logger:

```typescript
const handler = async (event: any, context: DurableContext) => {
  context.logger.info("Processing started", { userId: event.userId });

  try {
    const result = await context.step("process", async (ctx) => {
      ctx.logger.debug("Step executing");
      return processData();
    });

    context.logger.info("Processing completed", { result });
    return result;
  } catch (error) {
    context.logger.error("Processing failed", error);
    throw error;
  }
};
```

Custom logger:

```typescript
context.configureLogger({
  customLogger: {
    log: (level, message, data, error) =>
      console.log(`[${level}] ${message}`, data),
    error: (message, error, data) => console.error(message, error, data),
    warn: (message, data) => console.warn(message, data),
    info: (message, data) => console.info(message, data),
    debug: (message, data) => console.debug(message, data),
  },
  modeAware: false, // Optional: show logs during replay (default: true)
});
```

**Tip for local development:** Set `modeAware: false` to see all logs during replay, which can be helpful for debugging:

```typescript
context.configureLogger({ modeAware: false });
```

## License

This project is licensed under the Apache-2.0 License.
