# AWS Durable Execution SDK - Concepts and Use Cases

## Introduction

AWS Durable Execution SDK enables developers to write multi-step applications that persist state as they progress. Developers can create durable functions and use durable operations like "steps" and "callbacks" to write resilient, long-running workflows. Durable functions checkpoint the result of each operation so its result becomes durable even if the function fails after the checkpoint.

Key capabilities:

- Each operation can run up to the Lambda function's timeout (maximum 15 minutes)
- The entire multi-operation function can execute for extended periods when invoked asynchronously
- When a function needs to wait for an event (timeout or callback), it suspends and resumes when the event arrives
- Functions only pay for active compute time, not for waiting

## Replay Model

Durable functions use a "replay" model to run the durable function code. When a durable function is first invoked, Lambda runs the developer's event handler from the beginning. Since this is the first invocation, the code runs normally by executing steps and persisting their results. The function may then terminate, either to complete, to wait for a timer or asynchronous event, or unintentionally due to failure.

When Lambda invokes the function for replay, the function runs from the beginning and checks each durable step to see if it has already completed in a previous invocation. If so, the replay process avoids rerunning the step's code and instead fetches its previously-returned result. Replay continues until it reaches an operation that has not previously completed, at which point it runs the operation normally.

**Important**: Code inside a checkpointed step will not be executed on replay, but any code outside a step will get executed again. Therefore, all code outside a step needs to be deterministic. This means code that fetches the current time, generates random numbers/UUIDs, or calls APIs that may return different results must be placed inside a step.

## Core Operations Overview

### Performing Durable Steps

Execute a function and checkpoint the result. The step will call the function the first time it runs, then checkpoint its result. On replay, the step will recall the checkpointed result instead of calling the function again.

```typescript
const res1 = await context.step(async () => FirstApi());
const res2 = await context.step(async () => SecondApi());
return { res1, res2 };
```

### Chain Lambda Functions Together

Invoke another durable Lambda function and wait for its result. The runtime guarantees idempotency with 'at-most-once' semantics.

```typescript
const result = await context.invoke("arn:aws:lambda:::function:doSomething", {
  hello: "there",
  event: event,
});
```

### Waiting for a Period of Time

Durably wait for a specified duration in seconds. The function invocation suspends so it doesn't pay for CPU while waiting.

```typescript
await context.step(async () => await ProcessTransaction());
await context.wait(60 * 60 * 24 * 7); // Wait 7 days (in seconds)
await context.step(async () => await SendFollowupEmail());
```

### Waiting for a Callback

Run a function to submit work to an external system, then suspend to wait for the external system to call back with the result.

```typescript
const result = await context.waitForCallback<StripeCallbackInfo>(
  async (callbackId) => await CallStripe(event, callbackId),
  { timeout: 300 },
);
```

The external system completes the callback by calling `SendDurableExecutionCallbackSuccess` or `SendDurableExecutionCallbackFailure` API.

### Wait for a Condition (Polling)

Wait for a condition to be met by repeatedly calling a check function, then determining whether to continue waiting.

```typescript
const result = await context.waitForCondition(
  async (state) => getCurrentState(state),
  {
    initialState: { status: "PENDING" },
    waitStrategy: createWaitStrategy({
      maxAttempts: 60,
      initialDelaySeconds: 5,
      maxDelaySeconds: 30,
      backoffRate: 1.5,
      shouldContinuePolling: (result) => result.status !== "CURRENT",
    }),
  },
);
```

### Run Durable Operations in Parallel

Run multiple durable operations in parallel with configurable concurrency and failure tolerance.

```typescript
const result = await context.parallel(
  [
    async (context) => await ChooseHotel(context),
    async (context) => await ChooseCar(context),
    async (context) => await ChoosePrize(context),
  ],
  {
    maxConcurrency: 2,
    completionConfig: { toleratedFailureCount: 1 },
  },
);
```

### Map a Function Over an Array

Process each item of an array with durable operations, running them concurrently with configurable limits.

```typescript
const results = await context.map(
  users,
  async (ctx, user) => await processUser(ctx, user),
  { maxConcurrency: 5 },
);
```

## Use Cases and Examples

### GenAI Agent

Basic form of a durable GenAI agent with an agentic loop that invokes the AI model and executes tools.

```typescript
const messages = [{ role: "user", content: event.prompt }];

while (true) {
  const { response, reasoning, tool } = await context.step(
    async () => await invokeModel(messages),
  );

  if (tool == null) {
    return response;
  }

  const result = await context.step(async () => await runTool(tool, response));
  messages.push(result);
}
```

### Agent Handoff

Allow an agent to delegate to another agent by invoking it and then quitting.

```typescript
const result = await context.step(async () => await runTool(tool, response));
if (isAgentHandoffTool(tool)) {
  return; // The other agent has now been durably started
}
```

### Fan-out/Fan-in

Fan out processing of work items across many Lambda functions, then aggregate results.

```typescript
export const handler = async (event, context) => {
  const workItems = event.workItems;
  const tasks = [];

  for (const workItem of workItems) {
    const task = context.invoke(processItemFunctionArn, workItem);
    tasks.push(task);
  }

  const results = await context.promise.all(tasks);
  return aggregate(context, results);
};
```

### Human In The Loop

Prepare an action using genAI, ask a human for approval, then perform the action once approved.

```typescript
export const handler = async (event, context) => {
  const todo = await context.step(async () => {
    return await invokeModelToDetermineNextAction(event);
  });

  const answer = await context.waitForCallback(
    async (callbackId) =>
      await sendEmail(event.approverEmail, todo, callbackId),
  );

  if (answer === "APPROVED") {
    await context.step(async () => await performAction(todo));
  } else {
    await context.step(
      async () => await recordRejected(todo, event.approverEmail),
    );
  }
};
```

### Saga Pattern to Rollback on Error

Register compensating actions before each step, then execute them in reverse if any step fails.

```typescript
export const handler = async (event, context) => {
  const { customerId, flight, car, hotel } = event;
  const compensations = [];

  try {
    compensations.push(() => flightClient.cancel(customerId));
    await context.step(async () => await flightClient.book(customerId, flight));

    compensations.push(() => carRentalClient.cancel(customerId));
    await context.step(async () => await carRentalClient.book(customerId, car));

    compensations.push(() => hotelClient.cancel(customerId));
    await context.step(async () => await hotelClient.book(customerId, hotel));
  } catch (e) {
    for (const compensation of compensations.reverse()) {
      await context.step(async () => await compensation());
    }
    throw e;
  }
};
```

## Best Practices

### Deterministic Replay

All non-deterministic code should be wrapped with `context.step` to guarantee the result will be exactly the same on replay.

```typescript
// Generating UUID
const id = await context.step("Generate UUID", async () => {
  return uuid.v4();
});

// Random number
const randomNum = await context.step("Generate random", async () => {
  return Math.random();
});

// Current timestamp
const timestamp = await context.step("Get timestamp", async () => {
  return Date.now();
});
```

### Avoid Replaying Side Effects

Wrap actions like logging or external API calls in steps to avoid repeating them on every replay.

```typescript
// ❌ This will log on every replay
console.log("Processing user", userId);
await context.step(async () => processUser(userId));

// ✅ This logs only once
await context.step(async () => {
  console.log("Processing user", userId);
  return processUser(userId);
});
```

### Use Child Contexts for Concurrent Operations

When running durable operations concurrently, use `runInChildContext` to ensure deterministic replay.

```typescript
async function doWork(ctx, waitTime) {
  const x = await ctx.step(async () => ...);
  await ctx.wait(waitTime);
  const y = await ctx.step(async () => ...);
  return x + y;
}

const s1 = context.runInChildContext(async (ctx) => doWork(ctx, 1000));
const s2 = context.runInChildContext(async (ctx) => doWork(ctx, 2000));
const res1 = await s1;
const res2 = await s2;
```

## Programming Model

### Event Handler Signature

Durable functions pass a `DurableContext` to the Lambda event handler:

```typescript
export const handler: DurableHandler<MyInput, string> = async (
  event: MyInput,
  context: DurableContext,
) => {
  // Perform durable operations using the DurableContext
};
```

### Optional Naming

All durable operations accept an optional `name` parameter for operational visibility:

```typescript
// With name
await context.step("fetch-user", async () => fetchUser(userId));

// Without name (name remains unset)
await context.step(async () => fetchUser(userId));
```

### Configuration

Operations accept a `config` parameter for customization:

```typescript
await context.step("api-call", async () => callExternalAPI(), {
  retryStrategy: retryPresets.exponentialBackoff(),
  semantics: StepSemantics.AtMostOncePerRetry,
  serdes: customSerdes,
});
```

## Limitations and Considerations

- Code outside steps must be deterministic
- Durable operations cannot be nested inside step functions (use `runInChildContext` instead)
- Each individual operation is limited by Lambda's timeout (max 15 minutes)
- Concurrent operations require explicit child contexts for deterministic replay
- Large payloads may require custom serialization strategies
