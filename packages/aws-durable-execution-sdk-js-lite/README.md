# @aws/durable-execution-sdk-js-lite

A small SDK for AWS Lambda durable functions in JavaScript. It has no dependencies and no
build step. It runs on the same Lambda durable execution service as
[`@aws/durable-execution-sdk-js`](https://www.npmjs.com/package/@aws/durable-execution-sdk-js),
with fewer features and less code.

The rules and design of this package are in [AGENTS.md](./AGENTS.md).

## Status

This package is an alpha. It is private and not published to npm. Its API can change.

## Requirements

- Node.js 22.12 or later. The SDK also runs on [LLRT](https://github.com/awslabs/llrt) in a
  container image, because it uses only `node:crypto`, `fetch` and timers.
- A Lambda function with durable execution enabled (`DurableConfig` in the function
  configuration).
- The function's execution role allows `lambda:CheckpointDurableExecution` and
  `lambda:GetDurableExecutionState` on the function. The AWS managed policy
  `AWSLambdaBasicDurableExecutionRolePolicy` contains both actions and the CloudWatch Logs
  actions.
- `ctx.invoke` also needs `lambda:InvokeFunction` on the invoked function.
- Durable functions are invoked by a qualified name: a version, an alias or `$LATEST`.

## Quick start

```js
import { withDurableExecution } from "@aws/durable-execution-sdk-js-lite";

export const workflow = async ({ event, ctx }) => {
  const user = await ctx.step({
    name: "create-user",
    fn: () => createUser(event.email),
  });
  await ctx.wait({ name: "one-day", seconds: 24 * 60 * 60 });
  await ctx.step({
    name: "send-welcome",
    fn: () => sendWelcomeEmail(user.id),
  });
  return { userId: user.id };
};

export const handler = withDurableExecution(workflow);
```

Set the Lambda handler to `handler`. Export `workflow` too. Tests run `workflow` with
`runDurable` (see [Testing](#testing)).

A complete example is in [examples/order-workflow.js](./examples/order-workflow.js). Its test
is [test/example.test.js](./test/example.test.js).

## How replay works

1. Lambda invokes the function several times during one execution.
2. Each invocation runs the workflow from the start.
3. The SDK saves the result of each completed operation in a checkpoint.
4. In a later invocation, a completed operation returns its saved result. Its `fn` does not
   run again.
5. Some operations need the service to act first: a wait, an open callback, an invoke and a
   scheduled retry. When the workflow can only wait for such an operation, the invocation
   ends. The service invokes the function again when the operation completes.
6. The SDK identifies an operation by its position in the call order. So the workflow must
   call its operations in the same order in every invocation.

So code outside operations runs in every invocation. Code inside a step runs until the step
completes once.

## API reference

Every operation takes one object. `name` is optional on every operation. Give every operation
a name: names appear in the execution history, and replay validation compares them. All times
are whole seconds.

### withDurableExecution(workflow, config)

Wraps a workflow as a Lambda handler.

- `workflow({ event, ctx, lambdaContext })`: `event` is the execution input, parsed from JSON.
  It is `{}` when the input is empty. `ctx` is the root durable context.
- `config.client` (optional): the client for the two durable execution APIs. The default
  client signs requests with the region and the credentials from the Lambda environment:
  the `AWS_ACCESS_KEY_ID` environment variables, or the container credentials endpoint
  that Lambda uses for SnapStart functions. Tests replace it.

The workflow's return value is the execution result. It is stored as JSON. A thrown error
fails the execution. The execution error has `ErrorType` set to the error's `name`, and
`ErrorMessage` set to its `message`. Only a `DurableOperationError` sets `ErrorType` from
its `errorType` and adds `ErrorData` from its `data`.

The returned handler throws if the event has no `DurableExecutionArn` or `CheckpointToken`.
This happens when durable execution is not enabled on the function.

```js
export const handler = withDurableExecution(workflow);
```

### ctx.step({ name, fn, retryStrategy, semantics, subType })

Runs `fn` once and saves its result.

- `fn({ logger, attempt })`: the work. `attempt` starts at 1. `logger` writes to `console`.
- `retryStrategy` (default `createRetryStrategy()`): decides whether a failed attempt runs
  again, and after how many seconds.
- `semantics` (default `"AT_LEAST_ONCE_PER_RETRY"`): see
  [Make steps idempotent](#make-steps-idempotent).
- `subType` (default `"Step"`): the `SubType` of the operation on the wire. See
  [Custom subtypes](#keep-custom-subtypes-valid-and-stable).

Returns a promise for the result of `fn`. A retry runs in a later invocation. After the last
attempt fails, the promise rejects with a `DurableOperationError`. Its `errorType` is the
thrown error's `name`.

```js
const price = await ctx.step({
  name: "get-price",
  fn: ({ attempt, logger }) => {
    logger.info("get-price attempt", attempt);
    return fetchPrice(event.sku);
  },
  retryStrategy: createRetryStrategy({ maxAttempts: 3 }),
});
```

### ctx.wait({ name, seconds })

Waits for `seconds` whole seconds. The service ends the wait. Returns a promise that resolves
to `undefined`.

```js
await ctx.wait({ name: "cooling-off", seconds: 60 * 60 });
```

### ctx.createCallback({ name, timeoutSeconds, heartbeatTimeoutSeconds, subType })

Creates a callback that an outside system completes. The argument is optional.

- `timeoutSeconds` (default: no timeout): the callback times out after this many seconds.
- `heartbeatTimeoutSeconds` (default: no heartbeat timeout): the callback times out if no
  heartbeat arrives for this many seconds.
- `subType` (default `"Callback"`): the `SubType` of the operation on the wire. See
  [Custom subtypes](#keep-custom-subtypes-valid-and-stable).

Returns a promise for `{ callbackId, result }`.

- `callbackId`: give it to the outside system. That system calls the Lambda API
  `SendDurableExecutionCallbackSuccess`, `SendDurableExecutionCallbackFailure` or
  `SendDurableExecutionCallbackHeartbeat` with this id.
- `result`: a promise for the raw string the sender sent. It is `undefined` if the sender sent
  no result. It rejects with a `DurableOperationError` when the callback fails or times out.
  A timeout has `errorType` `"CallbackTimeoutError"`. A failure has the `ErrorType` the sender
  sent.

```js
const { callbackId, result } = await ctx.createCallback({
  name: "approval",
  timeoutSeconds: 24 * 60 * 60,
});
await ctx.step({ name: "notify", fn: () => sendApprovalEmail(callbackId) });
const answer = JSON.parse((await result) ?? "{}");
```

### ctx.waitForCallback({ name, submitter, timeoutSeconds, heartbeatTimeoutSeconds, retryStrategy })

Creates a callback, runs `submitter` in a step, and waits for the callback result.

- `submitter({ callbackId, logger })`: sends `callbackId` to the outside system.
- `timeoutSeconds`, `heartbeatTimeoutSeconds`: as in `createCallback`.
- `retryStrategy` (default `createRetryStrategy()`): retries of the submitter step.

Returns a promise for the raw result string, or `undefined`. Errors keep their `errorType`:
`"CallbackTimeoutError"`, the sender's `ErrorType`, or the `name` of the submitter's error.

```js
const answer = await ctx.waitForCallback({
  name: "approval",
  timeoutSeconds: 24 * 60 * 60,
  submitter: ({ callbackId }) => sendApprovalEmail(callbackId),
});
const { approved } = JSON.parse(answer ?? "{}");
```

### ctx.invoke({ name, functionName, input, tenantId })

Invokes another durable function and waits for its result.

- `functionName`: a qualified function name or ARN, with a version, an alias or `$LATEST`.
- `input` (optional): sent as JSON.
- `tenantId` (optional): the tenant id for the invoked function.

Returns a promise for the invoked function's result, parsed from JSON. In TypeScript, pass
the result type: `ctx.invoke<Receipt>({ ... })`. If the invoked function fails, times out or
is stopped, the promise rejects with a `DurableOperationError`. Its `errorType` is the invoked
function's `ErrorType`.

```js
const receipt = await ctx.invoke({
  name: "charge",
  functionName: "payment-service:live",
  input: { orderId: "o-1", amount: 80 },
});
```

### ctx.waitForCondition({ name, fn, initialState, waitStrategy })

Checks a condition repeatedly, with a wait between checks.

- `fn({ state, attempt, logger })`: one check. It returns the new state. A throw fails the
  operation without a retry.
- `initialState`: the state for the first check. It is stored as JSON.
- `waitStrategy({ state, attempt })`: returns `{ shouldContinue, delaySeconds }`.
  `shouldContinue: false` ends the operation. `delaySeconds` defaults to 1. `attempt` is the
  number of the check that just ran, starting at 1.

Returns a promise for the last state. The service schedules each next check, like a `wait`.

```js
const job = await ctx.waitForCondition({
  name: "wait-for-export",
  initialState: { status: "RUNNING" },
  fn: () => getExportJob(jobId),
  waitStrategy: ({ state, attempt }) => ({
    shouldContinue: state.status === "RUNNING" && attempt < 20,
    delaySeconds: 30,
  }),
});
```

### ctx.runInChildContext({ name, fn, subType })

Groups operations in a child context.

- `fn({ ctx })`: the group. Use the child `ctx` inside `fn`.
- `subType` (default `"RunInChildContext"`): the `SubType` of the operation on the wire. See
  [Custom subtypes](#keep-custom-subtypes-valid-and-stable).

Returns a promise for the result of `fn`. A completed child context returns its saved result.
It does not run `fn` again. If `fn` throws, the promise rejects with a `DurableOperationError`
with the same `errorType`.

```js
const profile = await ctx.runInChildContext({
  name: "build-profile",
  fn: async ({ ctx: child }) => {
    const a = await child.step({ name: "account", fn: () => getAccount(id) });
    const p = await child.step({ name: "prefs", fn: () => getPrefs(id) });
    return { ...a, ...p };
  },
});
```

### ctx.map({ name, items, fn, maxConcurrency, itemName, completionConfig })

Runs `fn` for every item. Each item runs in its own child context. Items start in index order.

- `items`: an array.
- `fn({ ctx, item, index })`: the work for one item. Use the item `ctx` inside `fn`.
- `maxConcurrency` (default: no limit): at most this many items run at once.
- `itemName({ item, index })` (optional): the name of each item's child context.
- `completionConfig` (optional): when the map completes early. See below.

Returns a promise for a `BatchResult`. The promise does not reject when an item fails.

A `BatchResult` has these members:

- `all`: one entry per started item, in index order: `{ index, status, result, error }`.
  `status` is `"SUCCEEDED"`, `"FAILED"` or `"STARTED"`. `error` is a `DurableOperationError`.
- `completionReason`: `"ALL_COMPLETED"`, `"MIN_SUCCESSFUL_REACHED"` or
  `"FAILURE_TOLERANCE_EXCEEDED"`.
- `getResults()`: the results of the items that succeeded, in index order.
- `getErrors()`: the errors of the items that failed, in index order.
- `throwIfError()`: throws the first item error, if any.

`completionConfig` has three optional keys:

- `minSuccessful`: complete when this many items succeeded.
- `toleratedFailureCount`: complete when more than this many items failed.
- `toleratedFailurePercentage`: complete when `failures / items.length * 100` is more than this.

The rules match the full SDK:

1. The map checks the keys after each item settles.
2. With no `completionConfig`, or with `{}`, one failure completes the map (fail fast).
3. With any key set, only the keys that are set apply. So `{ minSuccessful: 2 }` alone
   tolerates any number of failures.
4. When the map completes early, no new item starts. Items that never started are absent
   from `all`.
5. An item that still runs is abandoned. Its entry is `{ index, status: "STARTED" }`. Its
   operations send no more checkpoints and do not run. A step whose `fn` already runs
   finishes `fn`, but its result is not saved.
6. `completionReason` is `"FAILURE_TOLERANCE_EXCEEDED"` if the failures exceed a tolerance.
   Else it is `"ALL_COMPLETED"` if every item settled. Else it is `"MIN_SUCCESSFUL_REACHED"`.

To run every item whatever fails, set `completionConfig: { toleratedFailurePercentage: 100 }`.

```js
const shipped = await ctx.map({
  name: "ship",
  items: order.lines,
  maxConcurrency: 5,
  itemName: ({ item }) => `ship-${item.sku}`,
  fn: ({ ctx: itemCtx, item }) =>
    itemCtx.step({ name: "ship", fn: () => shipLine(item) }),
});
shipped.throwIfError();
const labels = shipped.getResults();

// Done when any 2 of the 5 replicas confirmed. Writes that still run are abandoned.
const quorum = await ctx.map({
  name: "replicate",
  items: replicas,
  completionConfig: { minSuccessful: 2 },
  fn: ({ ctx: itemCtx, item }) =>
    itemCtx.step({ name: "write", fn: () => writeTo(item, record) }),
});
// The reason is "ALL_COMPLETED" when the last replica settles the quorum. So count results.
if (quorum.getResults().length < 2) {
  throw new Error("fewer than 2 replicas confirmed");
}
```

### ctx.parallel({ name, branches, maxConcurrency, completionConfig })

Runs every branch. Each branch runs in its own child context.

- `branches`: an array of `{ name, fn }`. `fn({ ctx })` is the branch. Use the branch `ctx`
  inside `fn`.
- `maxConcurrency` (default: no limit): at most this many branches run at once.
- `completionConfig` (optional): as in `map`. The default is fail fast.

Returns a promise for a `BatchResult`, as in `map`.

```js
const checks = await ctx.parallel({
  name: "checks",
  branches: [
    { name: "fraud", fn: ({ ctx: b }) => b.step({ fn: () => checkFraud(id) }) },
    { name: "credit", fn: ({ ctx: b }) => b.step({ fn: () => checkCredit(id) }) },
  ],
});
checks.throwIfError();
const [fraud, credit] = checks.getResults();
```

### createRetryStrategy(config)

Returns a retry strategy for `step` and `waitForCallback`. All options are optional.

- `maxAttempts` (default 6): the total number of attempts, including the first one.
- `initialDelaySeconds` (default 5): the delay before the second attempt.
- `maxDelaySeconds` (default 60): the largest delay.
- `backoffRate` (default 2): each delay is this many times the previous one.
- `jitter` (default `true`): multiplies each delay by a random number between 0 and 1.
- `shouldRetry({ error })` (default: retry every error): return `false` to fail at once.

Delays are rounded to whole seconds. The smallest delay is 1 second.

A retry strategy is also a plain function: `({ error, attempt }) => ({ shouldRetry,
delaySeconds })`. `attempt` is the number of the attempt that just failed, starting at 1.

```js
import { createRetryStrategy } from "@aws/durable-execution-sdk-js-lite";

const retryStrategy = createRetryStrategy({
  maxAttempts: 4,
  jitter: false,
  shouldRetry: ({ error }) => error.name !== "ValidationError",
});
```

### DurableOperationError

Every failed operation throws a `DurableOperationError`, in the first run and in a replay.

- `errorType`: the original error's `name`, or an SDK value such as `"CallbackTimeoutError"`.
- `message`: the original error's message.
- `data` (optional): a string with extra data.
- `cause` (optional).

Throw a `DurableOperationError` to set `errorType` and `data` directly. The SDK reads
`errorType` and `data` only from a `DurableOperationError`. Other errors keep only their
`name` and `message`. Many HTTP clients put an object in `error.data`. The service accepts
only a string in `ErrorData`. So the SDK does not send `data` from other errors.

```js
import { DurableOperationError } from "@aws/durable-execution-sdk-js-lite";

throw new DurableOperationError({
  errorType: "OrderRejected",
  message: "The approver rejected the order",
  data: JSON.stringify({ orderId: "o-1" }),
});
```

### ctx.logger

`ctx.logger` has `debug`, `info`, `warn` and `error`. Each method calls the `console` method
with the same name. The logger writes nothing while `ctx.replaying` is true. So a line logged
outside a step appears once, not once per invocation. The `logger` passed to a step's `fn`
always writes, because a completed step does not run again.

```js
ctx.logger.info("order loaded", { orderId: order.id });
```

### ctx.replaying

`ctx.replaying` is `true` while the context replays operations that an earlier invocation
completed. It becomes `false` at the first operation that has no saved record.

```js
if (!ctx.replaying) metrics.increment("orders.started");
```

## Testing

`runDurable` from `@aws/durable-execution-sdk-js-lite/testing` runs a workflow locally
against an in-memory service. It needs no AWS account. It invokes the workflow again after
each suspension, like Lambda does. It has a virtual clock: it moves time to the next wait,
retry or callback timeout, so tests do not wait in real time.

Options:

- `workflow`: the workflow, not the `withDurableExecution` handler.
- `input` (optional): the execution input.
- `onCallback({ callbackId, name })` (optional): answers each callback. Return
  `{ result: string }` or `{ error: { ErrorType, ErrorMessage } }`. Return `undefined` to leave
  the callback open. The callback that `waitForCallback` creates has no name, so `name` is
  `undefined` for it.
- `functions` (optional): an object that maps a `functionName` to a local function for
  `ctx.invoke`. The function receives `{ input }`. `input` is the parsed input, or `null`
  without input. Its return value is the invoke result.
  A thrown error fails the invoke with `ErrorType` set to the error's `name`.
- `maxInvocations` (default 100): `runDurable` throws after this many invocations.
- `pageSize` (optional): serves the execution state in pages of this size, to test
  pagination.

`runDurable` resolves to an object with these fields:

- `status`: `"SUCCEEDED"`, `"FAILED"` or `"PENDING"`. `"PENDING"` means that nothing can make
  progress, for example a callback that `onCallback` left open.
- `result`: the workflow result, when `status` is `"SUCCEEDED"`.
- `error`: `{ ErrorType, ErrorMessage, ErrorData }`, when `status` is `"FAILED"`.
- `operations`: every operation record, in start order.
- `invocations`: the number of invocations.
- `getOperation(name)`: the first operation record with this name.

The in-memory service does not simulate heartbeat timeouts.

The in-memory service rejects some requests that the real service rejects. A rejected request
fails the execution, as in AWS. It rejects:

- a request body larger than 6 MiB plus 11 KiB, the service's limit on the HTTP request;
- a member such as `Name`, `Payload` or `Error.ErrorData` that is not a string;
- a STEP or CONTEXT `Payload` larger than 256 KiB, and a CHAINED_INVOKE `Payload` larger than
  1 MiB;
- a `START` for an operation that exists, unless it is a STEP in status `READY`;
- two updates for one operation in one request, unless a STEP or CONTEXT `START` comes
  first.

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { runDurable } from "@aws/durable-execution-sdk-js-lite/testing";
import { workflow } from "../examples/order-workflow.js";

test("an approved order is confirmed", async () => {
  const run = await runDurable({
    workflow,
    input: { orderId: "o-1" },
    onCallback: () => ({
      result: JSON.stringify({ approved: true, approver: "alice" }),
    }),
    functions: {
      "payment-service:live": () => ({ paymentId: "p-1" }),
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result.status, "CONFIRMED");
  assert.equal(run.getOperation("cooling-off").Type, "WAIT");
});
```

## Best practices

The SDK does not check for the mistakes below at run time. Follow these rules instead.

### Keep code outside steps deterministic

Code outside steps runs again in every invocation. The SDK identifies operations by their
call order. So the code outside steps must make the same calls in the same order every time.

- Do not use `Date.now()`, `new Date()`, `Math.random()` or `crypto.randomUUID()` outside a
  step. Get such values inside a step: the step saves the value, and a replay returns the
  same value.
- Do not branch on the environment, on the time, or on module-level state outside a step.

```js
const orderId = await ctx.step({
  name: "new-id",
  fn: () => crypto.randomUUID(),
});
```

### Do all I/O inside steps

Network calls, database calls and file access go inside a step. A call outside a step runs
again in every invocation.

The SDK ends an invocation when no step is running and some operation waits for the service.
The SDK does not see a plain `await` on a fetch or a timer. So such an `await` outside a step
can be cut off when the invocation ends.

### Await every durable operation

Await each operation, or pass its promise to an awaited `Promise.all` or `Promise.race`. A
rejected promise that nothing awaits is an unhandled rejection. The SDK also does not wait
for an operation that the workflow does not await. So the invocation can return before that
operation finishes.

### After createCallback, await only durable operations until you await the result

An open callback counts as waiting for the service at once. If the workflow then awaits
something other than a durable operation, no step is running. So the SDK can end the
invocation in the middle of that `await`. Await only durable operations until you await
`result`.

### Use only the ctx passed to the current function

Inside `runInChildContext`, a `map` item and a `parallel` branch, use the `ctx` passed to `fn`.
Items and branches run concurrently. Calls on the outer `ctx` happen in a different order in
each invocation. So their ids change, and replay fails or returns the wrong saved result.

### Never call durable operations inside a step's fn

A step's `fn` can run again on a retry. An operation called inside it gets a new position in
each run. To group operations, use `runInChildContext`.

### Return JSON-safe values

The SDK stores every result as JSON.

1. In the first run, an operation returns the exact value that `fn` returned.
2. In a replay, it returns `JSON.parse` of the stored JSON.
3. So the two are equal only when the value does not change shape through JSON.
4. The SDK does not check this. Returning such a value is your responsibility.

A value changes shape through JSON in these cases:

- A `Date` becomes an ISO string.
- A field whose value is `undefined` is dropped.
- A class instance becomes a plain object without its prototype and methods.
- A `Map` or a `Set` becomes `{}`.
- A `BigInt` makes `JSON.stringify` throw. So the operation throws a `TypeError`.

Return plain objects, arrays, strings, numbers, booleans and `null`. Convert a `Date` to a
string inside `fn`, for example with `toISOString()`. Also do not change the returned object
after the operation returns, because the stored JSON keeps the old value.

### Keep step results small

Each result is stored in a checkpoint. The service limits the size of a checkpoint. A child
context result larger than 256 KiB is rebuilt on replay, at extra cost. Store a large payload
in Amazon S3 inside the step, and return the S3 key.

### Do not change the operation order while executions run

Each invocation replays the saved records with the code it runs. If you reorder, rename, insert or
remove operations, the saved records no longer match the calls. The SDK compares the type,
the subtype and the name of each record with the call. A mismatch fails the execution with
`errorType` `"NonDeterministicExecutionError"`.

1. Two unnamed steps have the same type and the same subtype. So the SDK cannot tell them
   apart.
2. So name every operation. The SDK then detects a change instead of returning another
   operation's saved result.
3. Invoke the function through a numbered version or an alias. Publish incompatible code as a
   new version, so running executions keep their code.

### Keep custom subtypes valid and stable

`step`, `createCallback` and `runInChildContext` accept a `subType`. It replaces the default
`SubType` of the operation on the wire. An empty string selects the default.

1. The service accepts 1 to 32 characters of letters, digits, `-` and `_`. The SDK does not
   check the value. So the service rejects an invalid `subType`, and the execution fails.
2. The SDK compares the subtype of each record with the call. So changing the `subType` of
   an operation fails running executions, like a rename.

### Parse callback results

A callback result is the raw string the sender sent. Call `JSON.parse` on it if the sender
sent JSON. Handle `undefined`: the sender can send no result.

### Check BatchResult for errors

`map` and `parallel` record a failed item in the result. They do not throw. By default they
stop at the first failure. Call `throwIfError()` to fail on any item error, or inspect
`getErrors()` and `completionReason`. With `minSuccessful`, count `getResults()`. Do not check
`completionReason` alone: when every item settled, it is `"ALL_COMPLETED"`, whether or not
`minSuccessful` items succeeded.

### Do not rely on abandoned items

An item that still runs when its batch completes early is abandoned (see `ctx.map`).

1. Its later operations do not run, and the SDK saves no checkpoint for them.
2. A step whose `fn` already runs when the batch completes finishes `fn`. Its side effects
   happen. Its result is not saved.
3. No later invocation runs the item again. The batch's saved result lists it as `STARTED`.
4. So an abandoned item's last step can have an effect that nothing records. Make that step
   idempotent, or make its effect safe to leave unfinished.

### Race operations inside a child context

For "the first one wins", put `Promise.race` inside `runInChildContext`. The child context
saves the winner as its result. A replay returns the saved winner. Without the child context,
a replay can pick a different winner.

```js
const winner = await ctx.runInChildContext({
  name: "fastest-quote",
  fn: ({ ctx: c }) =>
    Promise.race([
      c.step({ name: "quote-a", fn: () => getQuoteA() }),
      c.step({ name: "quote-b", fn: () => getQuoteB() }),
    ]),
});
```

The same pattern replaces `Promise.all`, `Promise.allSettled` and `Promise.any` on durable
operations.

`Promise.race` does not stop the losing branches.

1. The losing branches keep running in the same invocation.
2. The SDK still saves their operations in checkpoints, after the child context has its
   result.
3. So a losing branch must not start more side effects after it loses. Make each branch one
   step. Or set a flag when the winner finishes, and check the flag in the loser before its
   next step.

In a later invocation, a completed child context can run `fn` again to rebuild a result larger
than 256 KiB. In that run, an operation without a saved record does not run, and neither does a
step that did not finish. Its promise never resolves. So a losing branch never continues in a
later invocation.

### Make steps idempotent

With the default semantics `"AT_LEAST_ONCE_PER_RETRY"`, `fn` can run more than once in one
attempt.

1. The SDK runs `fn`. Then it queues the result for the next checkpoint request and returns
   the result at once. It does not wait for the request.
2. If the invocation ends before that request succeeds, the step has no saved result.
3. So the next invocation runs `fn` again. Later steps in the same invocation may already have
   used the first result.

So make `fn` idempotent. For example, pass an idempotency key to the API you call. Do not use
a value that an at-least-once step generates, such as a random id, as the idempotency key of
a later step: a second run of the step generates a different value.

Use `"AT_MOST_ONCE_PER_RETRY"` when a second run is harmful and the API has no idempotency
key. The SDK then saves the start of the attempt before it runs `fn`. It also waits until the
result is saved before the step returns. If the attempt was
interrupted, the SDK does not run `fn` again. It treats the attempt as failed with
`errorType` `"StepInterruptedError"` and asks the retry strategy. To run `fn` at most once in
total, also set a retry strategy that never retries:

```js
await ctx.step({
  name: "send-payment",
  semantics: "AT_MOST_ONCE_PER_RETRY",
  retryStrategy: () => ({ shouldRetry: false }),
  fn: () => sendPayment(order),
});
```

### Check errorType, not the error class

Every failed operation throws a `DurableOperationError`. The original error class is not
kept, so `instanceof` a custom class is `false`. Compare `err.errorType` with the original
error's `name`. Set `name` in a custom error class, otherwise it is `"Error"`.

```js
try {
  await ctx.step({ name: "reserve", fn: () => reserve(item) });
} catch (err) {
  if (err.errorType !== "OutOfStockError") throw err;
  await ctx.step({ name: "backorder", fn: () => backorder(item) });
}
```

## Differences from @aws/durable-execution-sdk-js

- Every operation takes one object with named keys. No operation has overloads.
- Times are whole seconds (`seconds`, `timeoutSeconds`). The `Duration` object does not
  exist.
- One error class exists: `DurableOperationError`. Use `errorType` to tell errors apart.
- No plugins, no OpenTelemetry hooks, no custom loggers and no custom serdes. Every value is
  stored as JSON. The logger writes to `console`.
- No timers and no polling inside an invocation. So a branch whose wait ends while another
  branch runs a step continues only in the next invocation. The same holds for retries and
  callbacks.
- `map` and `parallel` support `minSuccessful`, `toleratedFailureCount` and
  `toleratedFailurePercentage`, and fail fast by default, like the full SDK. They have no
  custom `shouldComplete` predicate. The result has `all`, `completionReason`,
  `getResults()`, `getErrors()` and `throwIfError()`. It has no counts, no `status` and no
  `succeeded()`, `failed()` or `started()`.
- After a `map` or `parallel` result larger than 256 KiB, a later invocation rebuilds the same
  result as the live run, including the `STARTED` items. The full SDK drops `STARTED` items
  in that case.
- No `ctx.promise.all`, `allSettled`, `any` or `race`. Use `Promise.*` inside
  `runInChildContext` (see [Race operations inside a child context](#race-operations-inside-a-child-context)).
- No linear retry, no retry presets, no `withRetry` and no `createWaitStrategy`.
- `ctx.invoke` errors keep the invoked function's `ErrorType`. The full SDK does not keep it.
- An at-least-once step returns as soon as `fn` settles. It does not wait until its result is
  saved. The full SDK waits.
- In the first run, an operation returns the value that `fn` returned. The full SDK returns a
  copy that it serialized and deserialized.
- `waitForCondition` validates replay like the other operations. The full SDK does not.
- No CommonJS build. CommonJS code loads the package with `require()`, which works for ES
  modules on Node.js 22.12 and later.
- No `AsyncLocalStorage`. The SDK passes its state explicitly through `ctx`.
