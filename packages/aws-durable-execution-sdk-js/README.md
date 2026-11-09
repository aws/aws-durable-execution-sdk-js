# AWS Durable Execution SDK for JavaScript

Write AWS Lambda durable functions in TypeScript or JavaScript: multi-step handlers that checkpoint each step and resume after waits and failures.

## Install

```bash
npm install @aws/durable-execution-sdk-js
```

## Quick start

```typescript
import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: { userId: string }, context: DurableContext) => {
    const user = await context.step("fetch-user", async () =>
      fetchUser(event.userId),
    );
    await context.wait({ seconds: 5 });
    return context.step("process-user", async () => processUser(user));
  },
);
```

`withDurableExecution` wraps your handler. Export the wrapped handler as the Lambda handler.

Each `step` checkpoints its result. On replay, the SDK returns the checkpointed result and does not run the step again. Code outside a step runs again on every replay. So code outside a step must be deterministic. Read the time, generate IDs, and call APIs inside a step. [Concepts](src/documents/CONCEPTS.md) explains the replay model.

## Common uses

### Wait

```typescript
await context.wait({ seconds: 30 });
await context.wait("rate-limit-delay", { minutes: 5 });
```

The function invocation ends during a wait. Lambda does not bill compute while the function waits.

### Group operations in a child context

`step` runs one function. To group several durable operations, use `runInChildContext`:

```typescript
const receipt = await context.runInChildContext("process-order", async (child) => {
  const order = await child.step("validate", async () => validate(event.order));
  await child.wait({ seconds: 1 });
  return child.step("charge", async () => charge(order));
});
```

### Invoke another function

```typescript
const payment = await context.invoke(
  "process-payment",
  "arn:aws:lambda:us-east-1:123456789012:function:payment-processor:1",
  { amount: 100, currency: "USD" },
);
```

A durable target function needs a version or alias qualifier in its ARN.

### Wait for an external system

`waitForCallback` gives your submitter a callback ID. The external system completes the callback with `SendDurableExecutionCallbackSuccess` or `SendDurableExecutionCallbackFailure`.

```typescript
const approval = await context.waitForCallback(
  "wait-for-approval",
  async (callbackId) => {
    await sendApprovalRequest(callbackId);
  },
  { timeout: { hours: 24 } },
);
```

To send the callback ID later, use `createCallback`. It returns the promise and the ID:

```typescript
const [approvalPromise, callbackId] = await context.createCallback("approval", {
  timeout: { hours: 24 },
});
await sendApprovalRequest(callbackId);
const approval = await approvalPromise;
```

### Poll until a condition holds

```typescript
const job = await context.waitForCondition(
  "wait-for-job",
  async (state) => ({ ...state, status: await getJobStatus(state.jobId) }),
  {
    initialState: { jobId: "job-123", status: "pending" },
    waitStrategy: (state, attempt) =>
      state.status === "completed"
        ? { shouldContinue: false }
        : { shouldContinue: true, delay: { seconds: Math.min(attempt * 2, 60) } },
  },
);
```

### Process many items

`map` runs a durable function for each item. `parallel` runs a list of branches. Both run in the same invocation. Each item runs in its own child context.

```typescript
const results = await context.map(
  "process-users",
  users,
  async (ctx, user) => ctx.step("process", async () => processUser(user)),
  { maxConcurrency: 5 },
);
results.throwIfError();
const processed = results.getResults();

const [a, b] = (
  await context.parallel("fetch-all", [
    async (ctx) => ctx.step("fetch-a", async () => fetchA()),
    async (ctx) => ctx.step("fetch-b", async () => fetchB()),
  ])
).getResults();
```

Without `completionConfig`, the first failed item completes the batch. `completionConfig` sets another rule, for example `{ minSuccessful: 8 }` or `{ toleratedFailureCount: 2 }`. To wait for every item, set `{ toleratedFailurePercentage: 100 }`. [Batch early completion](src/documents/BATCH_COMPLETION.md) explains what happens to items that are still running when a batch completes.

`context.promise.all`, `race`, `any`, and `allSettled` combine durable promises that already run. They have no concurrency limit and no completion rule. So use them only for short operations, and use `map` or `parallel` for the rest.

### Log

```typescript
context.logger.info("Processing started", { userId: event.userId });

await context.step("process", async (stepCtx) => {
  stepCtx.logger.debug("Step running");
});
```

The logger adds the execution ARN, the request ID, and the operation to each entry. By default it does not repeat log entries during replay. To log during replay, call `context.configureLogger({ modeAware: false })`. [Logging](src/documents/LOGGING.md) covers custom loggers and Powertools for AWS Lambda.

## Advanced

### Retries

A step that throws is retried by its retry strategy. `createRetryStrategy` builds an exponential backoff strategy:

```typescript
import {
  createRetryStrategy,
  JitterStrategy,
} from "@aws/durable-execution-sdk-js";

await context.step("call-api", async () => callApi(), {
  retryStrategy: createRetryStrategy({
    maxAttempts: 5,
    initialDelay: { seconds: 1 },
    maxDelay: { seconds: 60 },
    backoffRate: 2,
    jitter: JitterStrategy.FULL,
    retryableErrors: [/timeout/i],
  }),
});
```

`retryStrategy` can also be a function `(error, attemptCount) => ({ shouldRetry, delay })`. `retryPresets` has ready-made strategies. A step that fails after its last attempt throws `StepError`.

### Step semantics

`semantics` sets what happens when an invocation ends while the step runs:

- `StepSemantics.AtLeastOncePerRetry` (default): the step runs again on replay. So it can run more than once per attempt.
- `StepSemantics.AtMostOncePerRetry`: the SDK checkpoints the start before the step runs. On replay, the SDK does not run that attempt again.

Both apply per retry attempt. So for a step that must run at most once in total, also disable retries:

```typescript
import { StepSemantics } from "@aws/durable-execution-sdk-js";

await context.step("charge-once", async () => chargeCard(order), {
  semantics: StepSemantics.AtMostOncePerRetry,
  retryStrategy: () => ({ shouldRetry: false }),
});
```

### Errors

Each durable operation throws its own error class when it fails, for example `StepError`, `CallbackError`, `InvokeError`, and `ChildContextError`. Every class extends `DurableOperationError`. The SDK checkpoints the error. So replay throws the same class, and code that branches on the class stays deterministic.

### Operation subtypes

`step`, `runInChildContext`, and `createCallback` accept a `subType` option, for example `{ subType: "OrderCharge" }`. The SDK records the subtype in the checkpoint and passes it to plugins. The service accepts 1 to 32 characters from `[a-zA-Z0-9-_]`. Replay compares the subtype with the checkpoint. So a changed subtype fails executions in flight.

### Configuration

`withDurableExecution(handler, config)` takes a `DurableExecutionConfig`. Its options include:

- `plugins`: instrumentation plugin factories. The `DURABLE_EXECUTION_PLUGINS` environment variable adds plugins at cold start. See [Instrumentation plugins](src/documents/PLUGINS.md).
- `durableExecutionClient`: a custom transport, or a `DurableExecutionApiClient` with your own `LambdaClient`. See [Custom transport](src/documents/CUSTOM_TRANSPORT.md).

The SDK runs on the Lambda managed Node.js runtimes `nodejs22.x` and `nodejs24.x`. [Runtime requirements](src/documents/RUNTIME_REQUIREMENTS.md) lists what other runtimes, such as LLRT, need.

## Reference

- [Concepts and use cases](src/documents/CONCEPTS.md): the replay model, best practices, and patterns.
- [Batch early completion](src/documents/BATCH_COMPLETION.md)
- [Logging](src/documents/LOGGING.md)
- [Instrumentation plugins](src/documents/PLUGINS.md), including the SDK 3.x plugin migration.
- [Custom transport](src/documents/CUSTOM_TRANSPORT.md)
- [Runtime requirements](src/documents/RUNTIME_REQUIREMENTS.md)
- [Running on Lambda Managed Instances](src/documents/LAMBDA_MANAGED_INSTANCES.md)
- [2.x to 3.0 migration guide](../../docs/migration-2.x-to-3.0.md)
- [Examples](../aws-durable-execution-sdk-js-examples/src/examples)
- [Testing SDK](../aws-durable-execution-sdk-js-testing): run durable functions in tests.
- [API reference](https://docs.aws.amazon.com/durable-execution/)
- [Source](src) and the TSDoc comments in [`src/types/durable-context.ts`](src/types/durable-context.ts).
- [Contributing](../../CONTRIBUTING.md)

## License

This project is licensed under the Apache-2.0 License.
