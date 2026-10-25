# @aws/durable-execution-sdk-js-lite

A small SDK for AWS Lambda durable functions in JavaScript. It has no dependencies and no
build step. It runs on the same Lambda durable execution service as
[`@aws/durable-execution-sdk-js`](https://www.npmjs.com/package/@aws/durable-execution-sdk-js),
with fewer features and less code.

To change this package, read [Contributing](#contributing) first.

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
  that Lambda uses for SnapStart functions. Tests replace it. See
  [Write a custom client](#write-a-custom-client).
- `config.plugins` (optional): an array of plugin factories. Each invocation calls every
  factory once. See [Plugins](#plugins).

The workflow's return value is the execution result. It is stored as JSON. A thrown error
fails the execution. The execution error has `ErrorType` set to the error's `name`, and
`ErrorMessage` set to its `message`. Only a `DurableOperationError` sets `ErrorType` from
its `errorType` and adds `ErrorData` from its `data`.

The returned handler throws if the event has no `DurableExecutionArn` or `CheckpointToken`.
This happens when durable execution is not enabled on the function.

```js
export const handler = withDurableExecution(workflow);
```

### ctx.step({ name, fn, retryStrategy, semantics, subType, serdes })

Runs `fn` once and saves its result.

- `fn({ logger, attempt })`: the work. `attempt` starts at 1. `logger` writes to `console`.
- `retryStrategy` (default `createRetryStrategy()`): decides whether a failed attempt runs
  again, and after how many seconds.
- `semantics` (default `"AT_LEAST_ONCE_PER_RETRY"`): see
  [Make steps idempotent](#make-steps-idempotent).
- `subType` (default `"Step"`): the `SubType` of the operation on the wire. See
  [Custom subtypes](#keep-custom-subtypes-valid-and-stable).
- `serdes` (default: JSON): stores the result. See [Serdes](#serdes).

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

### ctx.createCallback({ name, timeoutSeconds, heartbeatTimeoutSeconds, subType, serdes })

Creates a callback that an outside system completes. The argument is optional.

- `timeoutSeconds` (default: no timeout): the callback times out after this many seconds.
- `heartbeatTimeoutSeconds` (default: no heartbeat timeout): the callback times out if no
  heartbeat arrives for this many seconds.
- `subType` (default `"Callback"`): the `SubType` of the operation on the wire. See
  [Custom subtypes](#keep-custom-subtypes-valid-and-stable).
- `serdes` (optional): an object with only `deserialize`. It turns the raw result string
  into the value of `result`. See [Serdes](#serdes).

Returns a promise for `{ callbackId, result }`.

- `callbackId`: give it to the outside system. That system calls the Lambda API
  `SendDurableExecutionCallbackSuccess`, `SendDurableExecutionCallbackFailure` or
  `SendDurableExecutionCallbackHeartbeat` with this id.
- `result`: a promise for the raw string the sender sent, or for `serdes.deserialize` of it.
  The raw string is `undefined` if the sender sent no result. It rejects with a `DurableOperationError` when the callback fails or times out.
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

### ctx.waitForCallback({ name, submitter, timeoutSeconds, heartbeatTimeoutSeconds, retryStrategy, serdes })

Creates a callback, runs `submitter` in a step, and waits for the callback result.

- `submitter({ callbackId, logger })`: sends `callbackId` to the outside system.
- `timeoutSeconds`, `heartbeatTimeoutSeconds`: as in `createCallback`.
- `retryStrategy` (default `createRetryStrategy()`): retries of the submitter step.
- `serdes` (optional): an object with only `deserialize`, as in `createCallback`.

Returns a promise for the raw result string, or `undefined`, or for `serdes.deserialize` of
the raw string. Errors keep their `errorType`:
`"CallbackTimeoutError"`, the sender's `ErrorType`, or the `name` of the submitter's error.

```js
const answer = await ctx.waitForCallback({
  name: "approval",
  timeoutSeconds: 24 * 60 * 60,
  submitter: ({ callbackId }) => sendApprovalEmail(callbackId),
});
const { approved } = JSON.parse(answer ?? "{}");
```

### ctx.invoke({ name, functionName, input, tenantId, payloadSerdes, resultSerdes })

Invokes another durable function and waits for its result.

- `functionName`: a qualified function name or ARN, with a version, an alias or `$LATEST`.
- `input` (optional): sent as JSON, or as the string that `payloadSerdes` returns.
- `tenantId` (optional): the tenant id for the invoked function.
- `payloadSerdes` (optional): an object with only `serialize`. It makes the payload from
  `input`. The invoked function receives the payload as its event and parses it as JSON.
  So `serialize` must return JSON text.
- `resultSerdes` (optional): an object with only `deserialize`. It reads the invoked
  function's result string. The default is `JSON.parse`.

Returns a promise for the invoked function's result, parsed from JSON or read by
`resultSerdes`. In TypeScript, pass
the result type: `ctx.invoke<Receipt>({ ... })`. If the invoked function fails, times out or
is stopped, the promise rejects with a `DurableOperationError`. Its `errorType` is the invoked
function's `ErrorType`.

A plugin can set the invoked function's trace header (see
[Trace header of an invoke](#trace-header-of-an-invoke)).

```js
const receipt = await ctx.invoke({
  name: "charge",
  functionName: "payment-service:live",
  input: { orderId: "o-1", amount: 80 },
});
```

### ctx.waitForCondition({ name, fn, initialState, waitStrategy, serdes })

Checks a condition repeatedly, with a wait between checks.

- `fn({ state, attempt, logger })`: one check. It returns the new state. A throw fails the
  operation without a retry.
- `initialState`: the state for the first check.
- `waitStrategy({ state, attempt })`: returns `{ shouldContinue, delaySeconds }`.
  `shouldContinue: false` ends the operation. `delaySeconds` defaults to 1. `attempt` is the
  number of the check that just ran, starting at 1.
- `serdes` (default: JSON): stores each state. A later check reads the saved state with
  `deserialize`. The first check gets `initialState` itself. See [Serdes](#serdes).

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

### ctx.runInChildContext({ name, fn, subType, serdes })

Groups operations in a child context.

- `fn({ ctx })`: the group. Use the child `ctx` inside `fn`.
- `subType` (default `"RunInChildContext"`): the `SubType` of the operation on the wire. See
  [Custom subtypes](#keep-custom-subtypes-valid-and-stable).
- `serdes` (default: JSON): stores the result. The 256 KiB limit applies to the string that
  `serialize` returns. See [Serdes](#serdes).

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

### ctx.map({ name, items, fn, maxConcurrency, itemName, completionConfig, itemSerdes, nesting })

Runs `fn` for every item. By default, each item runs in its own child context. Items start
in index order.

- `items`: an array.
- `fn({ ctx, item, index })`: the work for one item. Use the item `ctx` inside `fn`.
- `maxConcurrency` (default: no limit): at most this many items run at once.
- `itemName({ item, index })` (optional): the name of each item's child context.
- `completionConfig` (optional): when the map completes early. See below.
- `itemSerdes` (default: JSON): stores each item's result in the item's own checkpoint.
  With `itemSerdes`, the map's checkpoint holds only the status of each item. A replay
  then reads each item's checkpoint with `itemSerdes.deserialize`. See [Serdes](#serdes).
- `nesting` (default `"NESTED"`): `"NESTED"` or `"FLAT"`. See below.

Returns a promise for a `BatchResult`. The promise does not reject when an item fails.

A `BatchResult` has these members:

- `all`: one entry per started item, in index order: `{ index, status, result, error }`.
  `status` is `"SUCCEEDED"`, `"FAILED"` or `"STARTED"`. `error` is a `DurableOperationError`.
- `completionReason`: `"ALL_COMPLETED"`, `"MIN_SUCCESSFUL_REACHED"`,
  `"FAILURE_TOLERANCE_EXCEEDED"`, `"CUSTOM_COMPLETION_SUCCEEDED"` or
  `"CUSTOM_COMPLETION_FAILED"`.
- `getResults()`: the results of the items that succeeded, in index order.
- `getErrors()`: the errors of the items that failed, in index order.
- `throwIfError()`: throws the first item error, if any. Else, if `completionReason` is
  `"CUSTOM_COMPLETION_FAILED"`, it throws a `DurableOperationError` with `errorType`
  `"BatchCompletionError"`.

`completionConfig` has thresholds or a predicate, not both. The thresholds are three
optional keys:

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

The predicate is the key `shouldComplete(status)`. It decides alone when the map completes.
Its rules also match the full SDK:

1. The map calls it before it starts each item and after each item settles.
2. `status` has `successCount`, `failureCount`, `completedCount`, `totalCount` and `items`.
   `items` has one entry `{ index, name, status }` per item, in index order. `name` is the
   result of `itemName`. `status` is `"SUCCEEDED"`, `"FAILED"`, `"STARTED"`, or absent for
   an item that has not started.
3. It returns `{ complete: false }` to continue. It returns `{ complete: true, outcome }` to
   complete the map now. `outcome` is `"SUCCEEDED"` (the default) or `"FAILED"`.
4. When it completes the map, no new item starts. Items that still run are abandoned, as
   with the thresholds. `completionReason` is `"CUSTOM_COMPLETION_SUCCEEDED"` or
   `"CUSTOM_COMPLETION_FAILED"`, by `outcome`.
5. The map also completes when every item settled. The map then still calls the predicate.
   If it returns `complete: true`, the reason follows `outcome` as in rule 4. Else the
   reason is `"ALL_COMPLETED"`.
6. Fail fast does not apply. A failed item completes the map only if the predicate says so.
7. A `"FAILED"` outcome does not make `map` throw. It returns the result. `throwIfError()`
   throws.
8. A replay does not call the predicate. It returns the saved result and reason.
9. The predicate must be deterministic and fast, and must not call durable operations (see
   [Keep completion predicates pure](#keep-completion-predicates-pure)).

The types forbid thresholds together with `shouldComplete`. The SDK does not check it. If
both are set, the predicate applies and the thresholds are ignored.

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

// Done when 2 replicas in different regions confirmed. Fails when that is no longer possible.
const spread = await ctx.map({
  name: "replicate-regions",
  items: replicas,
  completionConfig: {
    shouldComplete: ({ items }) => {
      const regions = new Set(
        items
          .filter((i) => i.status === "SUCCEEDED")
          .map((i) => replicas[i.index].region),
      );
      if (regions.size >= 2) return { complete: true, outcome: "SUCCEEDED" };
      const open = new Set(
        items
          .filter((i) => i.status !== "FAILED")
          .map((i) => replicas[i.index].region),
      );
      if (open.size < 2) return { complete: true, outcome: "FAILED" };
      return { complete: false };
    },
  },
  fn: ({ ctx: itemCtx, item }) =>
    itemCtx.step({ name: "write", fn: () => writeTo(item, record) }),
});
// Throws a failed replica's error, or "BatchCompletionError" when no item failed.
spread.throwIfError();
```

`nesting` selects how the map records its items:

1. With `"NESTED"`, each item is a child context. It has its own `CONTEXT` operation, with a
   `START` and a `SUCCEED` or `FAIL` update. A replay returns a finished item's saved result
   and does not run its `fn`.
2. With `"FLAT"`, an item has no operation of its own. Its operations are children of the
   map's operation. So each item saves one operation and two checkpoint updates. The item
   still takes an operation id, so its operations have the same ids as with `"NESTED"`.
   The full SDK uses the same ids.
3. A FLAT item has no record that says it finished. So until the map completes, every
   invocation that reaches the map runs each started item's `fn` again. Its operations
   return their saved results, so no step runs again. Its code outside the operations runs
   again. A failed item fails again with the same error, because its failed step throws its
   saved error again.
4. After the map completes, a replay returns the map's saved result. No item runs. The
   exception is a result larger than 256 KiB, or a map with `itemSerdes`: a replay then
   runs `fn` again for each item that had finished. Its steps return their saved results.
   A NESTED item then returns its own saved result instead.
5. The execution history shows no entry per item. `itemName` is still passed to
   `shouldComplete`, but it is not sent.
6. A FLAT item has no checkpoint to hold its result. So it never calls `itemSerdes`. With
   `itemSerdes` set, the map still saves only the statuses. A replay then returns the
   values that `fn` returns again.
7. Early completion abandons FLAT items like NESTED items.

See [Use FLAT for large maps of small items](#use-flat-for-large-maps-of-small-items).

### ctx.parallel({ name, branches, maxConcurrency, completionConfig, itemSerdes, nesting })

Runs every branch. By default, each branch runs in its own child context.

- `branches`: an array of `{ name, fn }`. `fn({ ctx })` is the branch. Use the branch `ctx`
  inside `fn`.
- `maxConcurrency` (default: no limit): at most this many branches run at once.
- `completionConfig` (optional): as in `map`. The default is fail fast. In the predicate's
  `items`, `name` is the branch name.
- `itemSerdes` (default: JSON): stores each branch's result, as in `map`.
- `nesting` (default `"NESTED"`): as in `map`. With `"FLAT"`, a branch has no operation of
  its own.

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

### Serdes

By default, the SDK stores every value as JSON. A serdes replaces JSON for one operation.
It is an object with two functions. Each function receives one object, and each can be
async.

- `serialize({ value, entityId, durableExecutionArn })`: returns the string to store, or
  `undefined` to store no payload.
- `deserialize({ data, entityId, durableExecutionArn })`: returns the value. `data` is the
  stored string, or `undefined` if none is stored.
- `entityId` is the operation's raw id, for example `"2"` or `"3-1"`. It is unique within
  one execution. `durableExecutionArn` is the execution's ARN. Together they form a key
  that is unique across executions.

The options are `serdes` on `step`, `waitForCondition` and `runInChildContext`,
`payloadSerdes` and `resultSerdes` on `invoke`, and `itemSerdes` on `map` and `parallel`.
`createCallback` and `waitForCallback` accept a `serdes` with only `deserialize`.

When the SDK calls each function:

1. In the first run, an operation calls `serialize` once. It returns the value that `fn`
   returned. It does not call `deserialize`.
2. In a replay, an operation calls `deserialize` on the stored string. It does not call
   `serialize`.
3. A callback result and an invoke result come from outside. So `deserialize` reads them
   in every run.
4. An at-least-once step awaits `serialize` before it queues its result. It still does not
   wait for the checkpoint.
5. If `serialize` or `deserialize` throws, the Lambda handler throws an error with `name`
   `"SerdesFailedError"`. Lambda then invokes the function again. The full SDK does the
   same.

The example below stores large values in Amazon S3. The checkpoint holds only the S3 key.

```js
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({});
const Bucket = process.env.PAYLOAD_BUCKET;

const s3Serdes = {
  async serialize({ value, entityId, durableExecutionArn }) {
    if (value === undefined) return undefined;
    const Key = `${encodeURIComponent(durableExecutionArn)}/${entityId}.json`;
    await s3.send(
      new PutObjectCommand({ Bucket, Key, Body: JSON.stringify(value) }),
    );
    return JSON.stringify({ s3: Key });
  },
  async deserialize({ data }) {
    if (data === undefined) return undefined;
    const { s3: Key } = JSON.parse(data);
    const res = await s3.send(new GetObjectCommand({ Bucket, Key }));
    return JSON.parse(await res.Body.transformToString());
  },
};

const report = await ctx.step({
  name: "build-report",
  fn: () => buildLargeReport(event.month),
  serdes: s3Serdes,
});
```

A step that runs again writes the same key again. So the new object replaces the old one.
The SDK never deletes the objects. Delete them with an S3 lifecycle rule.

### Plugins

A plugin observes an invocation. It can measure, trace or log the workflow's operations.
A plugin cannot change what the workflow does.

A plugin factory is a function `factory(info)`. It returns a plugin object, or `undefined`
for no plugin in this invocation. `withDurableExecution(workflow, { plugins })` takes an
array of factories.

1. The SDK calls each factory once per invocation, in array order. The call happens after
   the SDK loaded every state page and before the workflow runs.
2. So each invocation has new plugin objects. A plugin keeps its per-invocation state on
   its object. A client or an exporter that all invocations share lives in the factory's
   closure (see [Keep plugin state on the plugin object](#keep-plugin-state-on-the-plugin-object)).
3. Without plugins, the SDK calls no plugin code.

`info` has these fields:

- `arn`: the `DurableExecutionArn`.
- `requestId`: `lambdaContext.awsRequestId`.
- `input`: the execution input. It is the same object as the workflow's `event`.
- `operations`: a new array of every operation record in the state.
- `updatedOperationIds`: the ids of the records that the service changed since the previous
  invocation, for example a wait that ended. It is the event's `UpdatedOperationIds`, or
  `[]`.
- `lambdaContext`: the Lambda context.

A plugin object has four optional hooks:

- `onOperationChange({ updated, operations })`: the SDK calls it after it stored the
  records of a checkpoint response. It calls it only when the response returned at least
  one record. `updated` holds the returned records. `operations` is a new array of every
  record. The SDK calls the hook synchronously and ignores its return value. It does not
  await a promise.
- `wrap({ kind, id, parentId, name, type, subType, attempt, fn })`: runs around user code.
  It must call `fn()` exactly once and return its result. `kind` selects the code:
  - `"invocation"`: the workflow function. The other fields are `undefined`.
  - `"context"`: the `fn` of a child context with a `CONTEXT` record. These are
    `runInChildContext`, `waitForCallback`, `map`, `parallel` and each NESTED item. A FLAT
    item has no record, so it is not wrapped. Its operations are. The SDK wraps every
    call of `fn`, also the re-run of a result larger than 256 KiB.
  - `"attempt"`: one attempt of a step's `fn`, including the submitter of
    `waitForCallback`, and one check of `waitForCondition`.
- `onInvocationEnd({ status, result, error, operations })`: the SDK calls it once, after
  it saved the last checkpoint and stored its records. The handler returns or throws
  after it. The SDK awaits the hooks of all plugins in parallel.
- `traceHeader({ id, parentId, name, functionName })`: returns the trace header for a
  `ctx.invoke`, or `undefined`. See [Trace header of an invoke](#trace-header-of-an-invoke).

For `"context"` and `"attempt"`, the fields describe the operation's record:

- `id`: the record's `Id`, the hashed operation id.
- `parentId`: the record's `ParentId`. It is `undefined` at the root.
- `name`, `type` (`"STEP"` or `"CONTEXT"`) and `subType`: the values that the SDK sends.
- `attempt`: the attempt number, starting at 1. It is `undefined` for `"context"`.

`status` in `onInvocationEnd` is one of these values:

- `"SUCCEEDED"`: `result` is the workflow's return value.
- `"FAILED"`: `error` is the `{ ErrorType, ErrorMessage, ErrorData }` that the handler
  returns to Lambda.
- `"PENDING"`: the invocation suspended, or a newer invocation took over.
- `"RETRYING"`: the handler throws `error` next. Lambda then invokes again. Examples: a
  checkpoint error that a new invocation can fix, and a serdes failure.

Several plugins compose in array order. The first plugin's `wrap` is the outermost. The
SDK builds the composed `wrap` once per invocation.

The SDK does not isolate errors from hooks (rule 1.2). No hook error is ignored:

1. A throw from a factory makes the handler throw. So Lambda invokes again.
2. A throw from `onOperationChange` ends the invocation. `onInvocationEnd` then receives
   `"RETRYING"`, and the handler throws.
3. A throw or a rejection from `onInvocationEnd` makes the handler throw.
4. A throw from `wrap` fails the code it wraps, like a throw from `fn`. For an attempt,
   the retry strategy then decides.
5. A throw from `traceHeader` rejects the promise of that `ctx.invoke`. The SDK then sends
   no START. If the workflow does not catch the error, the execution fails with it.

The records use the wire format of the Lambda API: `Id`, `ParentId`, `Type`, `SubType`,
`Name`, `Status`, `StartTimestamp`, `EndTimestamp`, `StepDetails` and the other details.
They are the objects that the SDK stores. So a plugin must not change them.

Every timestamp in a record is a number of epoch seconds, possibly fractional. The
checkpoint API sends seconds. The Lambda invocation event sends epoch milliseconds, and
the SDK converts the event's records to seconds when it loads them. So `info.operations`,
`updated` and `operations` all use seconds:

```js
const ms = (t) => t * 1000;
```

The example below logs the duration of each step attempt. It writes its lines at the end
of the invocation.

```js
const timing = ({ requestId }) => {
  const lines = [];
  return {
    async wrap({ kind, name, attempt, fn }) {
      if (kind !== "attempt") return fn();
      const start = Date.now();
      try {
        return await fn();
      } finally {
        lines.push({ requestId, name, attempt, ms: Date.now() - start });
      }
    },
    onInvocationEnd({ status }) {
      console.log(JSON.stringify({ status, attempts: lines }));
    },
  };
};

export const handler = withDurableExecution(workflow, { plugins: [timing] });
```

`wrap` above is async. So it returns a promise even when `fn` returns a plain value. The
SDK awaits what `wrap` returns, for every kind. So an async `wrap` is correct.

#### Trace header of an invoke

A `CHAINED_INVOKE` START can carry `ChainedInvokeOptions.XAmznTraceId`. The service gives
that value to the invoked function as its Lambda trace header. The invoked function reads
it from `lambdaContext.xRayTraceId` and from `process.env._X_AMZN_TRACE_ID`. So a tracing
plugin can put the invoked execution into the caller's trace.

1. The SDK calls `traceHeader` when `ctx.invoke` builds its START update. That is once per
   invoke, in the invocation that starts it. A replay finds the record, so it never calls
   the hook.
2. The SDK calls the hook synchronously, after `payloadSerdes` and before the checkpoint.
3. The argument describes the `CHAINED_INVOKE` operation. `id` and `parentId` are the
   record's `Id` and `ParentId`. `name` and `functionName` are the values passed to
   `ctx.invoke`.
4. The SDK calls the plugins in array order. The first one that returns a non-empty string
   wins. The SDK calls no later plugin.
5. The SDK puts that string into `ChainedInvokeOptions.XAmznTraceId` unchanged. It does
   not check the format. The format is the X-Ray header, for example
   `Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1`.
6. Without a string, the START has no `XAmznTraceId`. The service then gives the invoked
   function the caller execution's own trace header.

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
  `ctx.invoke`. The function receives `{ input, traceHeader }`. `input` is the parsed
  input, or `null` without input. `traceHeader` is the `XAmznTraceId` that a plugin's
  `traceHeader` hook set, else `undefined`. Its return value is the invoke result.
  A thrown error fails the invoke with `ErrorType` set to the error's `name`.
- `maxInvocations` (default 100): `runDurable` throws after this many invocations.
- `plugins` (optional): plugin factories, as in `withDurableExecution`. Each simulated
  invocation calls every factory again. The fake Lambda context has
  `awsRequestId` `"request-1"`, `"request-2"` and so on. Each invocation event has
  `UpdatedOperationIds`: the ids of the records that changed after the previous
  invocation's last checkpoint response, for example a wait that the virtual clock ended.
- `pageSize` (optional): serves the execution state in pages of this size, to test
  pagination.
- `service` (optional): a service from `createInMemoryService(options)`. The options above
  for the service are then ignored. Pass one to change records during an invocation, as the
  real service does. `service.advanceBy(seconds)` moves the virtual clock and ends the
  waits and retry delays that are due. `service.boundary()` applies the callback answers
  and invoke results. The next checkpoint response reports the changed records.

`runDurable` resolves to an object with these fields:

- `status`: `"SUCCEEDED"`, `"FAILED"` or `"PENDING"`. `"PENDING"` means that nothing can make
  progress, for example a callback that `onCallback` left open.
- `result`: the workflow result, when `status` is `"SUCCEEDED"`.
- `error`: `{ ErrorType, ErrorMessage, ErrorData }`, when `status` is `"FAILED"`.
- `operations`: every operation record, in start order.
- `invocations`: the number of invocations.
- `invocationErrors`: the invocation errors that the service would record, in order. One
  is an error that the handler threw. The other is a `PENDING` output while no wait,
  callback, invoke or step retry is pending. The service then invokes again, so
  `runDurable` does too. A test can assert that this list is empty.
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

Without a serdes, the SDK stores every result as JSON.

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

To keep a `Date` or a class instance, pass a [serdes](#serdes) instead. The same rule then
applies to the serdes (see [Make serdes round trips exact](#make-serdes-round-trips-exact)).

### Make serdes round trips exact

The first run returns the value that `fn` returned. A replay returns `deserialize` of the
stored string.

1. So `deserialize(serialize(v))` must return a value equivalent to `v`. Otherwise the
   first run and a replay see different values, and the workflow can take a different
   path.
2. The SDK does not check this. The full SDK calls `deserialize` in the first run too.
3. `serialize` and `deserialize` must not call durable operations. An operation inside
   them would get an id in an order that depends on timing.
4. `serialize` can run again for the same `entityId`: an at-least-once step can run
   again, and a failed attempt can retry. So make it safe to repeat, for example by
   overwriting the same storage key.
5. Do not use a random key in `serialize`. Use `durableExecutionArn` and `entityId`.

### Keep step results small

Each result is stored in a checkpoint. The service limits the size of a checkpoint. A child
context result larger than 256 KiB is rebuilt on replay, at extra cost. Store a large payload
in Amazon S3 inside the step, and return the S3 key. Or pass a serdes that stores the value
in S3 (see [Serdes](#serdes)).

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
`minSuccessful` items succeeded. With `shouldComplete`, `throwIfError()` also throws when the
predicate returned `outcome: "FAILED"`.

### Keep completion predicates pure

`shouldComplete` decides how many items run. A replay does not call it again.

1. The SDK calls it many times in one run: before each start and after each settle.
2. The SDK calls it synchronously, between items. A slow predicate delays every item.
3. A durable operation inside it would get an operation id in an order that depends on
   timing. So a replay could find a different operation and fail the execution.
4. So read only its `status` argument and values that never change, such as the `items`
   array. Return the same answer for the same `status`. Do not call `ctx`, do no I/O, and
   do not use `Date.now()` or `Math.random()`.

### Use FLAT for large maps of small items

A NESTED item costs one `CONTEXT` operation and two checkpoint updates more than a FLAT
item. A map of 100 one-step items creates 201 operations with `"NESTED"` and 101 with
`"FLAT"`.

1. A FLAT item runs its `fn` again in every invocation that reaches the map before the map
   completes. Its steps return their saved results. Its code outside steps runs again.
   A NESTED item that finished returns its saved result instead.
2. So use `nesting: "FLAT"` when each item is one step or a few steps, and its code outside
   steps is cheap.
3. Keep `"NESTED"` when an item has much code outside steps, or when you need one entry per
   item in the execution history.
4. The code outside steps must be deterministic in both modes (see
   [Keep code outside steps deterministic](#keep-code-outside-steps-deterministic)).

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

### Keep plugin hooks fast, and do not throw from them

The SDK calls `onOperationChange` and `wrap` on the path of every operation. So a slow
hook slows every operation.

1. Do no network call and no file access in `onOperationChange` or `wrap`. Push the data
   to an array on the plugin object instead.
2. The SDK does not catch errors from hooks. A throw ends the invocation, or fails the
   wrapped code (see [Plugins](#plugins)). So catch your own errors inside each hook.

### Call fn exactly once in wrap, and return its result

The SDK passes `fn` to `wrap` and uses the value that `wrap` returns as the result of the
user code.

1. If `wrap` does not call `fn`, the user code does not run. Its operation never finishes.
2. If `wrap` calls `fn` twice, the user code runs twice. A step then has its side effects
   twice.
3. If `wrap` returns another value, the operation saves that value.
4. So call `fn()` once and return what it returns, or a promise for it. The SDK does not
   check this.

### Never call durable operations in plugin hooks

The SDK identifies an operation by its position in the call order (section 2.4). A hook
runs when a checkpoint response arrives, and its timing changes between invocations. So an
operation called from a hook gets a different id in each invocation, and replay fails. Use
only the hook's arguments and your own clients in a hook.

### Do not change operation records

`info.operations`, `updated`, `operations` and the records in them are the objects that
the SDK stores. The SDK reads them to replay and to decide when an operation continues. So
a changed record changes what the workflow does. Copy a record before you change it.

### Buffer in hooks, send in onInvocationEnd

The SDK awaits only `onInvocationEnd`. It does not await `onOperationChange` or `wrap`
beyond `fn`.

1. So a network call that starts in another hook can still run when the handler returns.
   Lambda then freezes the sandbox, and the call can fail or arrive late.
2. So collect the data on the plugin object, and send it in `onInvocationEnd`.
3. The handler returns only after `onInvocationEnd` settles. A slow exporter delays the
   handler and costs Lambda time. So give every network call a timeout, for example with
   `AbortSignal.timeout(ms)`.
4. A rejection from `onInvocationEnd` makes the handler throw, and Lambda invokes again.
   So catch the exporter's errors when a lost export is acceptable.

### Keep plugin state on the plugin object

The SDK calls each factory once per invocation. Lambda Managed Instances can run several
invocations in one process at the same time.

1. So keep per-invocation state, such as open spans and buffers, on the object that the
   factory returns, or in variables inside the factory call.
2. Keep shared state, such as an HTTP client or an exporter, in the closure that creates
   the factory. Create it once, outside the factory call.
3. Do not keep per-invocation state in module-level variables.

```js
const exporter = createExporter(); // shared by every invocation

const tracing = ({ requestId }) => {
  const spans = []; // this invocation only
  return {
    wrap: ({ kind, name, fn }) => {
      spans.push({ requestId, kind, name, start: Date.now() });
      return fn();
    },
    onInvocationEnd: async () => {
      try {
        await exporter.send(spans, { signal: AbortSignal.timeout(2000) });
      } catch (err) {
        console.warn("trace export failed", err);
      }
    },
  };
};
```

### Write a custom client

`config.client` replaces the built-in client. Use it to call the APIs through another
HTTP stack, a proxy or the AWS SDK. A custom client is an object with two async methods,
`checkpoint(request)` and `getExecutionState(request)`. Requests and responses use the
field names of the Lambda API.

The SDK decides what to do after a failed call from the error's fields:

- `name`: the AWS error code, for example `"InvalidParameterValueException"`.
- `status`: the HTTP status as a number, for example `400`.
- `message`: the error message.

1. A 4xx status other than 429 fails the execution. The one exception is an invalid
   checkpoint token: Lambda then invokes again. An error whose `name` starts with `KMS` and
   ends with `Exception` also fails the execution.
2. Any other error, including a missing `status`, makes Lambda invoke again.
3. So a client that throws errors without `status` turns a permanent error into a retry.
   Lambda then invokes again and again until the execution times out.

The AWS SDK v3 puts the status in `$metadata.httpStatusCode`. So copy it to `status`:

```js
import {
  CheckpointDurableExecutionCommand,
  GetDurableExecutionStateCommand,
  LambdaClient,
} from "@aws-sdk/client-lambda";

const lambda = new LambdaClient({});
const send = async (command) => {
  try {
    return await lambda.send(command);
  } catch (err) {
    err.status ??= err.$metadata?.httpStatusCode;
    throw err;
  }
};

export const handler = withDurableExecution(workflow, {
  client: {
    checkpoint: (request) => send(new CheckpointDurableExecutionCommand(request)),
    getExecutionState: (request) =>
      send(new GetDurableExecutionStateCommand(request)),
  },
});
```

## Differences from @aws/durable-execution-sdk-js

- Every operation takes one object with named keys. No operation has overloads.
- Times are whole seconds (`seconds`, `timeoutSeconds`). The `Duration` object does not
  exist.
- One error class exists: `DurableOperationError`. Use `errorType` to tell errors apart.
- Plugins have a factory and four hooks: `onOperationChange`, `wrap`,
  `onInvocationEnd` and `traceHeader`. No hook marks the start or the end of an operation
  or of an attempt. The SDK does not isolate hook errors. It awaits only
  `onInvocationEnd`. Hooks receive wire records, not `OperationInfo` objects. No
  OpenTelemetry hooks beyond these, no `enrichLogContext`, no plugins loaded from the
  environment, and no custom loggers. The logger writes to `console`.
- Propagation to an invoke is one hook, `traceHeader`, that returns the X-Ray header
  string. The full SDK's propagation metadata hook returns an object
  `{ xAmznTraceId }`. The lite SDK calls the hook only when it sends the START. It takes
  the first plugin's string.
- Serdes functions receive one object: `serialize({ value, entityId, durableExecutionArn })`
  and `deserialize({ data, entityId, durableExecutionArn })`. They can return a value or a
  promise.
- No `ctx.configureSerdes` and no default serdes for a context. Pass a serdes to each
  operation. No `createClassSerdes`, `createClassSerdesWithDates` or file-system serdes.
- `map` and `parallel` take `itemSerdes`, but no `serdes` for the whole `BatchResult`. With
  `itemSerdes`, the batch stores only the item statuses, and a replay reads each item
  through `itemSerdes`. The full SDK stores the item values in the batch result as JSON.
- A `waitForCondition` check receives `initialState` itself, and `waitStrategy` receives
  the state that `fn` returned. The full SDK sends these values through `serialize` and
  `deserialize` first.
- A child context that rebuilds a result larger than 256 KiB calls no serdes. The full SDK
  calls `serialize` and `deserialize` again.
- No timers and no polling inside an invocation. The service reports a changed record in
  each checkpoint response. So a branch whose wait ends while another branch runs a step
  continues when the next checkpoint response reports the end. That response usually
  answers the running step's SUCCEED, so the branch continues in the same invocation. The
  same holds for step retries, callbacks and invokes. The full SDK also starts a timer for
  the wait's end and polls the service.
- `map` and `parallel` support `minSuccessful`, `toleratedFailureCount`,
  `toleratedFailurePercentage` and the `shouldComplete` predicate, and fail fast by default,
  like the full SDK. The predicate returns a plain object. The `completeBatch()` and
  `continueBatch()` helpers and the `CompletionOutcome` enum do not exist. Thresholds
  together with a predicate do not fail the execution: the predicate applies. The result has
  `all`, `completionReason`, `getResults()`, `getErrors()` and `throwIfError()`. It has no
  counts, no `status` and no `succeeded()`, `failed()` or `started()`.
- With `nesting: "FLAT"`, an item never calls `itemSerdes`. The full SDK calls `serialize`
  and `deserialize` on the item's value, and stores nothing.
- After a `map` or `parallel` result larger than 256 KiB, a later invocation rebuilds the same
  result as the live run, including the `STARTED` items. The full SDK drops `STARTED` items
  in that case.
- No `ctx.promise.all`, `allSettled`, `any` or `race`. Use `Promise.*` inside
  `runInChildContext` (see [Race operations inside a child context](#race-operations-inside-a-child-context)).
- No linear retry, no retry presets, no `withRetry` and no `createWaitStrategy`.
- `ctx.invoke` errors keep the invoked function's `ErrorType`. The full SDK does not keep it.
- An at-least-once step returns as soon as `fn` settles. It does not wait until its result is
  saved. The full SDK waits.
- In the first run, an operation returns the value that `fn` returned. It does not call
  `deserialize`. The full SDK returns a copy that it serialized and deserialized, with the
  default JSON serdes and with a custom serdes.
- `waitForCondition` validates replay like the other operations. The full SDK does not.
- No CommonJS build. CommonJS code loads the package with `require()`, which works for ES
  modules on Node.js 22.12 and later.
- No `AsyncLocalStorage`. The SDK passes its state explicitly through `ctx`.

## Contributing

This section is for people and AI agents who change this package. Read it before you
change any file here. Section numbers such as "rule 1.2" and "section 2.5" refer to the
headings below. Code comments cite them as "README 2.5".

The lite SDK is a small rewrite of `@aws/durable-execution-sdk-js`. It runs the same durable
functions on the same Lambda durable execution service. It has far less code. When this
section and the full SDK disagree, this section wins inside this package.

### 1. Rules

#### 1.1 Simplicity first

1. Keep the logic simple. Option B is simpler than option A. Option B loses a minor feature of
   option A. Then choose option B.
2. Do not add a mechanism only to make a rare case faster. Correctness is required. Speed in
   rare cases is not.
3. Do not add configuration that nobody asked for.

#### 1.2 Best practices instead of safeguards

1. Developers use this SDK. Attackers do not. So the SDK does not protect developers from
   their own mistakes.
2. Do not add runtime checks for developer misuse. Examples of checks we do not add: argument
   type validation, detecting a parent `ctx` used inside a child, limits on concurrency values.
3. Instead, write the correct usage in [Best practices](#best-practices).
4. One exception exists. Replay validation (section 2.6) stays. It turns a silent wrong
   result into a clear failure. It costs about 10 lines.

#### 1.3 No dependencies

1. `package.json` has no `dependencies`, no `devDependencies`, no `peerDependencies`, and no
   `optionalDependencies`.
2. Use only Node.js built-in modules, imported with the `node:` prefix.
3. Do not import `@aws-sdk/*`. The package signs and sends its own HTTP requests (section 2.2).
4. Tests use `node:test` and `node:assert/strict`. Run them with `node --test`.
5. The repository root has tooling such as Biome. That tooling is not a dependency of this
   package. Do not reference it from this package's `package.json`.

#### 1.4 No build step

1. The source is plain ES module JavaScript (`.js`). `package.json` sets `"type": "module"`.
2. Types are hand-written in `src/index.d.ts` and `src/testing/index.d.ts`. Update them in the
   same change as the code they describe.
3. Node does not strip TypeScript types inside `node_modules`. So the package cannot ship
   `.ts` files.
4. Minimum Node version is 22.12. From that version, CommonJS code can `require()` this
   package. So the package ships no CommonJS build. Do not use top-level `await`, because it
   prevents `require()`.

#### 1.5 No async context and no module state

1. Do not import `node:async_hooks`. Do not use `AsyncLocalStorage` or `AsyncResource`.
2. Pass state explicitly. Each invocation creates one execution object. Each `ctx` holds a
   reference to it.
3. Do not keep per-invocation state in module-level variables. Lambda Managed Instances can
   run several invocations in one Node process at the same time. Module-level state would be
   shared between them.

#### 1.6 Out of scope

These features of the full SDK are not in the lite SDK. Do not add them without a decision
from the package owner.

- Plugins beyond the factory and the four hooks of section 2.12: OpenTelemetry hooks
  beyond these, `enrichLogContext`, propagation metadata beyond `traceHeader`, plugins
  loaded from environment variables, and isolation of hook errors. The package owner
  decided to add the plugin interface of section 2.12 only. The package owner added
  `traceHeader` later, so that a tracing plugin can join an invoked execution to the
  caller's trace.
- External or custom loggers.
- `configureSerdes` and any default serdes for a context. The package owner decided to
  add per-operation serdes only (section 2.11). The `serdes` option for a whole
  `BatchResult`, `createClassSerdes` and `createClassSerdesWithDates` are out of scope
  too.
- In-invocation timers and polling. Section 2.5, suspension steps 12 to 14, explains the
  effect.
- `ctx.promise.all/allSettled/any/race`. [Race operations inside a child context](#race-operations-inside-a-child-context)
  documents the replacement pattern.
- Linear retry, retry presets, `withRetry`, `createWaitStrategy`.
- The `Duration` object. All times are plain seconds.
- The `NestingType` enum and `virtualContext` on `runInChildContext`. The package owner
  decided to add `nesting: "NESTED" | "FLAT"` on `map` and `parallel` only, as a plain
  string (section 2.9).
- Custom summary generators, file-system serdes.
- Error subclasses. One error class exists (section 2.7).
- The `completeBatch()` and `continueBatch()` helpers and the `CompletionOutcome` enum.
  The `shouldComplete` predicate of `map` and `parallel` is in scope (section 2.9). It
  returns a plain object.

#### 1.7 API shape

1. Every operation takes exactly one argument. The argument is an object with named keys.
   One exception exists: when every key of the argument is optional, the caller may omit
   the argument, as in `ctx.createCallback()`.
2. No operation has overloads. The code never checks argument types to decide which form the
   caller used.
3. Every function that the developer passes to the SDK also receives exactly one object.
4. `name` is optional on every operation.
5. A function key is called `fn`, not `function`. `function` is a reserved word, so
   `const { function } = opts` is a syntax error.
6. A time is a number of seconds. The key name says the unit: `seconds`, `timeoutSeconds`,
   `heartbeatTimeoutSeconds`, `delaySeconds`.

#### 1.8 Code style

1. Small files with one concern each. Prefer functions and plain objects over classes. The
   error class is the exception.
2. Comments explain why, in short sentences: the fact, then the consequence, then the decision.
3. Every behavior has a test. Tests live in `test/` and end in `.test.js`.
4. Before a commit, run `npm test` in this folder and `npx biome check
   packages/aws-durable-execution-sdk-js-lite` from the repository root. Both must pass.
5. Commit titles use the scope `sdk-lite`, for example `feat(sdk-lite): add wait`.

### 2. Design

#### 2.1 Files

```
src/index.js               public exports
src/index.d.ts             public types
src/with-durable-execution.js   Lambda handler wrapper
src/execution.js           per-invocation state, checkpoint queue, suspension
src/context.js             the ctx object and operation ids
src/errors.js              DurableOperationError and ErrorObject conversion
src/retry.js               createRetryStrategy
src/logger.js              replay-aware console logger
src/serdes.js              calls a custom serdes (section 2.11)
src/plugins.js             plugin factories and hooks (section 2.12)
src/operations/*.js        one file per operation
src/transport/sigv4.js     SigV4 signing with node:crypto
src/transport/lambda-client.js  HTTPS client for the two durable APIs
src/testing/*.js           local test runner (subpath export "./testing")
test/*.test.js             tests
```

#### 2.2 Service API

The SDK calls two Lambda APIs. Both use API version `2025-12-01`, JSON bodies, and SigV4
signing for service `lambda`.

- `CheckpointDurableExecution`: `POST /2025-12-01/durable-executions/{arn}/checkpoint`. Body
  `{CheckpointToken, ClientToken, Updates}`. Response `{CheckpointToken, NewExecutionState:
  {Operations, NextMarker}}`.
- `GetDurableExecutionState`: `GET /2025-12-01/durable-executions/{arn}/state` with query
  `CheckpointToken`, `Marker`, `MaxItems`. Response `{Operations, NextMarker}`.

Rules for the client:

1. Credentials come from `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN`.
   If `AWS_ACCESS_KEY_ID` is not set, they come from `AWS_CONTAINER_CREDENTIALS_FULL_URI`,
   with `AWS_CONTAINER_AUTHORIZATION_TOKEN` as the `authorization` header. Lambda uses that
   endpoint for SnapStart functions. The client caches those credentials and fetches them
   again 5 minutes before they expire. Region comes from `AWS_REGION`.
2. The endpoint is `AWS_ENDPOINT_URL_LAMBDA`, else `AWS_ENDPOINT_URL`, else
   `https://lambda.{region}.amazonaws.com`.
3. Each checkpoint call generates one `ClientToken` with `crypto.randomUUID()`. HTTP retries
   of that call reuse the same token. So the service applies the call at most once.
4. The client retries HTTP 429, HTTP 5xx and network errors up to 3 attempts in total.
5. A failed call throws an `Error` with `name` (the AWS error code), `status` (the HTTP status)
   and `message`. `classify` in `execution.js` reads only these fields. A custom client must
   throw the same shape. [Write a custom client](#write-a-custom-client) and the
   `DurableExecutionClient` type state this. The SDK does not read other shapes, such as the
   AWS SDK's `$metadata.httpStatusCode` (rule 1.2).
6. The client is an object with two async methods: `checkpoint(request)` and
   `getExecutionState(request)`. Requests and responses use the API field names above. Tests
   and the local runner replace the client through `withDurableExecution(handler, { client })`.

#### 2.3 Invocation flow

1. Lambda calls the wrapped handler with `{DurableExecutionArn, CheckpointToken,
   InitialExecutionState: {Operations, NextMarker}}`.
2. The SDK loads the remaining pages with `GetDurableExecutionState` until `NextMarker` is
   empty. If a page request fails, the SDK throws from the Lambda handler, so Lambda invokes
   again.
   The event's records hold timestamps as epoch milliseconds (numbers), as observed in
   AWS. The API's records hold epoch seconds. The SDK converts the event's
   `StartTimestamp`, `EndTimestamp`, `StepDetails.NextAttemptTimestamp` and
   `WaitDetails.ScheduledEndTimestamp` to seconds. A string is parsed as ISO 8601. So
   every stored timestamp is epoch seconds.
3. The first operation is the `EXECUTION` operation. The user event is
   `JSON.parse(ExecutionDetails.InputPayload)`, or `{}` if the payload is empty.
4. With plugins, the SDK calls the plugin factories (section 2.12).
5. The SDK calls `handler({ event, ctx, lambdaContext })`.
6. The SDK returns one of these objects to Lambda:
   - `{Status: "SUCCEEDED", Result: JSON.stringify(value)}`. `Result` is absent for
     `undefined`.
   - `{Status: "FAILED", Error: ErrorObject}`.
   - `{Status: "PENDING"}`.
7. If `Result` is larger than `6 * 1024 * 1024 - 50` bytes, the SDK checkpoints
   `{Type: "EXECUTION", Action: "SUCCEED", Payload: Result}` first. It then returns
   `{Status: "SUCCEEDED", Result: ""}`. The full SDK gives this update the id
   `"execution-result-" + Date.now()`, hashed. The lite SDK does the same.
8. With plugins, the SDK awaits `onInvocationEnd` before it returns or throws.
9. If the SDK throws from the Lambda handler, Lambda records an invocation error and the
   service invokes the function again. The SDK throws only for errors that a new invocation
   can fix (section 2.8).

#### 2.4 Operation ids

1. Each `ctx` has a counter that starts at 0.
2. Each operation call increments the counter synchronously, at call time, before any `await`.
3. The raw id is `String(n)` in the root context. In a child context it is
   `` `${childRawId}-${n}` ``.
4. The id sent to the service is the first 16 hex characters of the MD5 hash of the raw id.
   `ParentId` is the hashed raw id of the enclosing child context. Root operations have no
   `ParentId`. A FLAT batch item is not a child context. So its operations have the
   batch's hashed id as `ParentId` (section 2.9, step 14).
5. These ids must match the full SDK exactly. The service and saved executions depend on them.
6. MD5 is the main CPU cost of an operation. So each ctx hashes each raw id once and keeps the
   hash in a map. It hashes its parent id once, when the ctx is created.

#### 2.5 Checkpoints and suspension

Checkpoint queue:

1. Each checkpoint token works once. Each response carries the next token. So only one
   checkpoint request is in flight at a time.
2. `execution.checkpoint(update)` adds the update to a pending list and returns a promise. The
   promise resolves when the request that carried the update succeeds.
3. When no request is in flight, the SDK sends the pending updates in one request. The service
   has no limit on the number of updates. It limits the raw HTTP request to about 6 MiB. So
   the SDK takes updates in order while the request body is at most `5 * 1024 * 1024` bytes.
   The SDK does not serialize an update to measure it. It adds an upper bound per update
   (`sizeBound` in `execution.js`): 2 bytes per UTF-8 byte of `Payload`, 6 bytes per
   character of a developer string, and 600 bytes for keys and numbers. A custom
   serialize can return any string, so its `Payload` counts as a developer string. The
   operation marks such an update with the symbol key `CUSTOM_PAYLOAD`. So the real body is
   never larger than the limit. The bound is about 2 times the real size for a large
   payload, so a request can carry about 2.5 MiB of payloads. The 1 MiB margin also leaves
   room for the HTTP headers.
   The first update is always taken, so an update larger than the limit goes alone. The rest
   wait for the next request.
4. After each response, the SDK stores the new token. It replaces each returned operation in
   the local state, keyed by `Id`. Operations read service-assigned fields from that state, for
   example `CallbackDetails.CallbackId`.
5. A response without a `CheckpointToken` means a newer invocation took over. The SDK returns
   PENDING. The one exception is a request that carried the `EXECUTION` update from 2.3 step 7.

Suspension:

1. An operation is blocked when its result needs the service to act first: a wait that has not
   ended, a callback that has not completed, an invoke that has not finished, or a step retry
   that is scheduled.
2. A blocked operation calls `ctx._block(rawId)`. The execution adds an entry to its blocked
   set: the hashed id, the record's Status at that moment, and a liveness check. The check
   turns false when a batch abandons the operation (section 2.9).
3. The service can change a record while the invocation runs, for example when a wait ends.
   It then returns the record in the next checkpoint response. After `flush` stores the
   returned records, it compares each blocked entry's Status with the stored record. If
   they differ, the entry leaves the blocked set, and its promise resolves. The full SDK
   does the same (`updateStepDataFromCheckpointResponse` and `resolveWaitingOperation` in
   `checkpoint-manager.ts`).
4. The operation then reads its record again and applies its replay table to it. It may
   return, throw, run the next step attempt, or block again. Each blocking operation is a
   loop around its replay table for this reason.
5. The wake happens before `flush` calls `checkIdle`. So the suspension check below never
   counts a woken operation as blocked.
6. An entry whose liveness check is false leaves the set without a wake. `ctx._block`
   also never resolves if the batch abandoned the operation after the wake. So an
   abandoned operation never runs again.
7. While a step function or a `waitForCondition` check runs, the execution's running count is
   above zero.
8. The execution suspends when all of these hold: the running count is 0, no checkpoint is
   pending or in flight, and at least one blocked operation is live. An abandoned operation
   must not count. Otherwise the invocation could suspend while the workflow awaits
   something else, and nothing that the workflow awaits would wake it.
9. The SDK checks the condition again after one `setImmediate`. This lets already-resolved
   promises start the next operation first. If it still holds, the invocation returns PENDING.
10. After the SDK decides to return PENDING, every later `checkpoint` call returns a promise that
   never resolves. So user code cannot run more side effects in this invocation.
11. After the handler returns or throws, the execution never suspends. An un-awaited blocked
   operation must not turn a finished handler into PENDING. So the SDK counts the finished
   handler as running while it saves the remaining checkpoints.
12. The invocation must never return PENDING while a blocked operation's latest record says
   that it can proceed. The SDK has no timers and does not poll. So a branch whose wait ends while another
   branch runs a step continues when the next checkpoint response reports the end
   (steps 3 to 5). That response usually answers the running step's outcome. So the
   branch continues in the same invocation.
13. A narrow window remains. The service can end a wait after the last checkpoint response
   and before the invocation returns PENDING. The service records PENDING while nothing is
   pending as an invocation error, and it invokes again a limited number of times. So
   before the SDK returns PENDING, it checks the live blocked records for a due time
   that has passed: `WaitDetails.ScheduledEndTimestamp` of a WAIT, or
   `StepDetails.NextAttemptTimestamp` of a STEP. Every stored timestamp is epoch
   seconds: the API sends seconds, and the SDK converts the invocation event's epoch
   milliseconds when it loads the state (section 2.3, step 2).
14. If such a time has passed, the SDK sends one checkpoint with `Updates: []`. Its response
   wakes the changed operations (step 3). Then the suspension check runs again. A refresh
   that wakes nothing is not repeated until an operation wakes. So the invocation then
   returns PENDING. A callback or an invoke has no due time, so it causes no refresh. The
   window stays open for them, and for a wait that ends during the refresh. This is
   accepted (rule 1.1).

#### 2.6 Replay

1. Before an operation acts, it looks up its id in the state.
2. If a record exists, its `Type`, `Name` and `SubType` must equal the current call. A missing
   `name` must match a missing `Name`. A mismatch ends the execution as FAILED with
   `errorType: "NonDeterministicExecutionError"`.
3. Each `ctx` has `replaying`. It is true while the last id that the `ctx` created had a record
   in the state. Before the first id, the root `ctx` is replaying if the state holds more than
   the `EXECUTION` record. A child `ctx` is replaying if its own context record exists. The
   logger is silent while `replaying` is true.
4. On the first run, an operation returns the value that `fn` returned. It does not parse the
   JSON it stored. On replay, it returns `JSON.parse` of the stored JSON. So the two are equal
   only for a JSON-safe value. Returning a JSON-safe value is the developer's responsibility
   ([Return JSON-safe values](#return-json-safe-values)). The SDK does not check it, because a check costs a
   parse on every operation.
5. The same rule holds for a custom serdes. The first run calls `serialize` and returns
   `fn`'s value. Only a replay calls `deserialize`. The full SDK calls `deserialize` on the
   first run too. Correctness does not need it: `deserialize(serialize(v))` must be
   equivalent to `v` anyway ([Make serdes round trips exact](#make-serdes-round-trips-exact)). Skipping it saves a
   call, for example an S3 read, per operation.

#### 2.7 Errors

1. The wire format is `ErrorObject = {ErrorType, ErrorMessage, ErrorData}`. Stack traces are not
   sent.
2. A failed operation always throws `DurableOperationError`. Its fields are `errorType`,
   `message`, `data` and `cause`.
3. On the first run, the SDK builds the thrown error from the same `ErrorObject` it
   checkpointed. So the first run and a replay throw the same error.
4. `errorType` is the original error's `name` (for example `"TypeError"`), or a fixed value when
   the SDK creates the error, for example `"CallbackTimeoutError"`.
5. Only a `DurableOperationError` supplies `ErrorType` from its `errorType` and `ErrorData`
   from its `data`. Any other value supplies `ErrorType` from `name` and `ErrorMessage` from
   `message`, and no `ErrorData`. Other libraries put objects in `data`. The service rejects
   a non-string `ErrorData`, and the rejection fails the execution. The full SDK does the
   same.

#### 2.8 Checkpoint error handling

1. HTTP 4xx other than 429, with name `InvalidParameterValueException` and a message starting
   with `"Invalid checkpoint token"`: throw from the Lambda handler. A new invocation gets a new
   token.
2. Any other HTTP 4xx except 429: return FAILED.
3. Names starting with `KMS` and ending with `Exception`: return FAILED.
4. Everything else, including 429, 5xx and network errors: throw from the Lambda handler.

#### 2.9 Operations

| Operation | Wire Type / SubType | Updates the SDK sends |
|---|---|---|
| `step` | `STEP` / `Step` | `START`, then `SUCCEED`, `RETRY` or `FAIL` |
| `wait` | `WAIT` / `Wait` | `START` with `WaitOptions.WaitSeconds` |
| `createCallback` | `CALLBACK` / `Callback` | `START` with `CallbackOptions` |
| `waitForCallback` | `CONTEXT` / `WaitForCallback` | child context with a callback and a step |
| `invoke` | `CHAINED_INVOKE` / `ChainedInvoke` | `START` with `Payload` and `ChainedInvokeOptions` |
| `waitForCondition` | `STEP` / `WaitForCondition` | `START`, then `RETRY` with `Payload`, `SUCCEED` or `FAIL` |
| `runInChildContext` | `CONTEXT` / `RunInChildContext` | `START`, then `SUCCEED` or `FAIL` |
| `map` | `CONTEXT` / `Map`, items `MapIteration` | child contexts; FLAT items send none |
| `parallel` | `CONTEXT` / `Parallel`, branches `ParallelBranch` | child contexts; FLAT branches send none |

The SubType column shows the defaults. `step`, `createCallback` and `runInChildContext`
accept a `subType` option that replaces the default, as in the full SDK. An empty string
selects the default. The SDK does not validate the value (rule 1.2).
[Keep custom subtypes valid and stable](#keep-custom-subtypes-valid-and-stable) documents
the service's limit. The other operations always send their default.

Each operation's file states its replay table in a comment at the top.

Steps:

1. An at-least-once step does not wait for any of its checkpoints except RETRY. It returns
   or throws as soon as `fn` settles. The queue keeps the update order. So a later operation's
   updates never reach the service before the step's outcome.
2. If the invocation ends before the outcome is saved, the step runs again in the next
   invocation. At-least-once allows this. The package owner chose lower latency over waiting.
3. An at-most-once step waits for START before `fn`, and for SUCCEED or FAIL before it
   returns or throws.
4. A step with a custom serdes awaits `serialize` before it queues SUCCEED. The SUCCEED
   needs the string. An at-least-once step still does not wait for the checkpoint.
5. Code that did not wait for a checkpoint can keep running after the invocation's outcome is
   decided. So a step checks `execution.done` before it runs `fn`, and never runs `fn` after
   that.

Child contexts (`runInChildContext`, `waitForCallback`, `map`, `parallel`):

1. The service drops the children of a completed context from the state. So a SUCCEEDED or
   FAILED context returns its stored result or error. It does not run `fn` again, because
   its steps would run again.
2. A result whose serialized string is larger than `256 * 1024` bytes does not fit in a
   checkpoint. The SDK sends
   `SUCCEED` with `Payload: ""` and `ContextOptions: {ReplayChildren: true}`. The service then
   keeps the children. On replay the SDK runs `fn` again. The children replay from their
   records, so no step runs again.
3. That re-run uses a replay-only child `ctx`. Its descendants are replay-only too. The
   context succeeded, so `fn` awaited only operations that ended. So an operation without a
   record, or a step or context that did not end, belongs to a branch that lost a race. In a
   replay-only `ctx` such an operation does nothing and returns a promise that never
   resolves. It does not count as blocked, because nothing that the result depends on
   awaits it. `ctx._mayRun` holds this check, and every operation calls it.

Map and parallel (`batch.js`):

1. A batch is a child context. With `nesting: "NESTED"` (the default), each item is a
   child context of the batch. A FLAT item has no context (steps 13 to 18). Items start
   in index order, so item i always has the raw id `` `${batchId}-${i + 1}` ``.
2. `completionConfig` follows the full SDK. It holds thresholds or a `shouldComplete`
   predicate. After each item settles, the batch checks it. With no threshold set, one
   failure completes the batch (fail fast). The `ctx.map` reference
   above lists the rules.
3. The predicate receives one object `{successCount, failureCount, completedCount,
   totalCount, items}`, as in the full SDK. It returns `{complete: false}` or `{complete:
   true, outcome}`. The batch also asks it before each item starts. If both are set, the
   predicate applies and the thresholds are ignored. That is the full SDK's check order.
   The full SDK also fails the execution with a validation error then. The lite SDK does
   not check this (rule 1.2).
4. A predicate's `"FAILED"` outcome sets `completionReason` to `"CUSTOM_COMPLETION_FAILED"`.
   The batch still returns. `throwIfError()` then throws a `DurableOperationError` with
   `errorType: "BatchCompletionError"` if no item failed. It builds the error from
   `completionReason` alone. Both the stored JSON and the ReplayChildren summary hold
   `completionReason`. So a replay throws the same error.
5. No replay calls the predicate. A SUCCEEDED batch record returns the stored result. A
   ReplayChildren re-run reads the saved reason (step 10). So a predicate that changes its
   answer cannot change a replayed result.
6. When the batch completes, it calls `ctx._abandonChildren()` on the batch ctx. Every item
   ctx and every descendant is then abandoned. `ctx._abandoned` reads the ancestors' flags
   at each call, because the flag is set after the item ctxs exist.
7. In an abandoned ctx, `_mayRun` returns false, and `_checkpoint` sends nothing and returns
   a promise that never resolves. Every operation sends its updates through `_checkpoint`.
   A child context sends its own START, SUCCEED and FAIL through its child ctx. So an
   abandoned item's own SUCCEED is not sent either. A step whose `fn` already runs finishes
   `fn`, and its outcome is not sent.
8. An update queued before the batch completed is still sent. The batch's SUCCEED is queued
   after it, and the queue keeps the order. So the service never receives an update for an
   operation inside a completed batch.
9. An item that settles after the decision keeps `STARTED` in the result.
10. A batch result larger than 256 KiB is not stored. The batch then saves
   `{completionReason, itemStatuses}` as the Payload. `itemStatuses` has one character per
   started item, in index order: `S` succeeded, `F` failed, `-` still running. This is the
   full SDK's format.
11. A ReplayChildren re-run must not run the scheduler again. Cached items settle in index
   order, not in the live order. So the scheduler could decide at a different item. Instead
   the re-run re-drives the items marked `S` or `F` in index order. They replay from their
   records. It takes the id of an item marked `-` with `ctx._nextId()` and does not run it.
   It never starts an item after the marks. So the result equals the live result, including
   the `STARTED` items. The full SDK drops `STARTED` items here.

12. With `itemSerdes`, the batch always saves the summary from step 10 with
   ReplayChildren. The full SDK stores the item values in the batch record as JSON. A
   replay of that record would not call `itemSerdes.deserialize`. So the lite SDK
   re-drives the items as in step 11, and each item replays its own record through
   `itemSerdes`. The cost: the service keeps the children of the batch.

FLAT items (`nesting: "FLAT"`):

13. A FLAT item has no `CONTEXT` operation. It sends no START, SUCCEED or FAIL. The full
   SDK's virtual context does the same (`run-in-child-context-handler.ts`: `isVirtual`
   skips the three checkpoints).
14. A FLAT item still takes the next id of the batch ctx, in index order. Its operations
   use that raw id as prefix, as in a NESTED item. Their `ParentId` is the batch's hashed
   id, because the item has no record. The full SDK passes the parent's `parentId` to a
   virtual child (`isVirtual ? parentId : entityId`). So the ids and ParentIds are the
   full SDK's. The default `"NESTED"` sends the same updates as before.
15. `ctx._child(rawId, { flat: true })` creates the item ctx. Its `parent` is the batch
   ctx, so abandonment (step 6) reaches it. A replay-only batch ctx makes it
   replay-only.
16. No record says that a FLAT item ended. So the scheduler and the re-run of step 11
   call the item's `fn` again in every run that reaches the item. The item does not call
   `_mayRun`, because it has no record to validate. Its operations call `_mayRun` and
   replay from their own records. A failed item fails again, because its failed
   operation throws its stored error again. A batch with a stored JSON result does not
   run its items (child contexts, step 1).
17. A FLAT item never calls `itemSerdes`. No record exists to hold the serialized value,
   and deserializing a value that was not stored changes nothing (section 2.6, step 5). With
   `itemSerdes` set, the batch still saves the summary with ReplayChildren (step 12). So
   the item values never pass through JSON: a replay runs each item's `fn` again and
   returns its value. The full SDK calls `serialize` and `deserialize` on the value and
   stores nothing.
18. The batch does not validate the `nesting` value. Any value except `"FLAT"` selects
   NESTED (rule 1.2).

#### 2.10 Logging

`ctx.logger` has `debug`, `info`, `warn` and `error`. Each forwards to the same `console`
method. It is silent while `ctx.replaying` is true. A step function receives a logger that is
never silent, because a completed step does not run again.

#### 2.11 Serdes

A serdes is `{ serialize, deserialize }`. Each function receives one object (rule 1.7):
`{ value, entityId, durableExecutionArn }` or `{ data, entityId, durableExecutionArn }`.
Each can return a value or a promise. The option names follow the full SDK:

| Operation | Option | Applies to |
|---|---|---|
| `step`, `runInChildContext`, `waitForCondition` | `serdes` | the result, and each state of `waitForCondition` |
| `invoke` | `payloadSerdes`, `resultSerdes` | `serialize` the input, `deserialize` the callee result |
| `createCallback`, `waitForCallback` | `serdes` (only `deserialize`) | the raw callback result |
| `map`, `parallel` | `itemSerdes` | each item's result, in the item's own record |

1. Without a serdes, the operation calls `JSON.stringify` and `JSON.parse` as before. It
   adds no `await`. Only an update with a custom `Payload` carries the `CUSTOM_PAYLOAD`
   key. A symbol key on every update made 3000 default steps about 3% slower. So the
   default path costs the same as before.
2. `entityId` is the operation's raw id, for example `"3-1"`. The full SDK passes the
   same value. `durableExecutionArn` comes from `execution.arn`.
3. A serdes call counts as running (section 2.5, suspension step 7). A step starts
   `serialize` before it ends its running count. Otherwise the invocation could suspend
   during an async call, and the operation would not continue in this invocation.
4. A throw from a serdes function ends the invocation with an error named
   `SerdesFailedError`. The Lambda handler throws it, so Lambda invokes again. The full
   SDK does the same (`safeSerialize` and `safeDeserialize` in `serdes-errors.ts`). A
   failed S3 call can succeed in the next invocation.
5. A callback result and an invoke result come from outside. So `deserialize` reads them
   in every run.
6. `serialize` receives `undefined` when the value is `undefined`. If `serialize` returns
   `undefined`, the update has no `Payload`. A replay then passes `data: undefined` to
   `deserialize`.
7. A ReplayChildren re-run of a child context returns `fn`'s value and calls no serdes.

#### 2.12 Plugins

A plugin factory is a function that `withDurableExecution` receives in `config.plugins`.
It returns a plugin object with up to four hooks. [Plugins](#plugins) documents the API.

The no-plugin path:

1. `withDurableExecution` calls `createPlugins` (`plugins.js`) only when
   `plugins?.length` is above 0.
2. `createPlugins` returns one function per hook, or `undefined` when no plugin has the
   hook. `createExecution` receives `onOperationChange`, `wrap` and `traceHeader`.
   `execution.wrap` and `execution.traceHeader` expose the composed hooks.
3. Each call point checks one variable. Without the hook, it calls the user code directly.
   The closure for `fn` and the wrap argument exist only in the branch with the hook. So
   an operation without plugins allocates nothing more than before.

The call points:

1. Factories: `withDurableExecution` in `with-durable-execution.js`. It calls them after
   `loadOperations` and before `createExecution`. A factory that throws makes the handler
   throw. `onInvocationEnd` is then not called. A failed page request throws before the
   factories run, so it calls no hook either.
2. `onOperationChange`: `flush` in `execution.js`, after it stores the returned records and
   before it wakes the blocked operations. It runs only when the response returned at
   least one record. A throw calls `terminate` with `kind: "throw"`. That is the outcome of
   a serdes failure. Without the `try`, the throw would reject the promise of `flush`.
   Nothing awaits that promise. Node.js ends the process on an unhandled rejection by
   default.
3. `wrap` with `"invocation"`: `run` in `with-durable-execution.js`, around the workflow
   call.
4. `wrap` with `"context"`: `runChild` in `operations/child-context.js`, around `fn`.
   `runInChildContext`, `waitForCallback`, `map`, `parallel` and NESTED items all go
   through `runChild`. A FLAT item runs in `flatItem` in `batch.js`, which has no wrap.
5. `wrap` with `"attempt"`: `runStep` in `operations/step.js` and `runCondition` in
   `operations/wait-for-condition.js`, around `fn`. The waitForCallback submitter is a
   step. `waitStrategy` and `retryStrategy` are not wrapped.
6. `wrapInfo` in `plugins.js` builds the argument. It takes `Id` and `ParentId` from
   `ctx._base`, so they equal the record's fields.
7. `traceHeader`: `runInvoke` in `operations/invoke.js`, in the branch without a record,
   after `payloadSerdes` and before `ctx._checkpoint`. The composed hook returns the first
   truthy value of the plugins in array order. `runInvoke` is async, so a throw rejects
   the invoke's promise, and no START is sent. `sizeBound` counts `XAmznTraceId` at 6
   bytes per UTF-16 unit, like the other developer strings, because the SDK does not
   check the string.
8. `onInvocationEnd`: `withDurableExecution`, after `run` resolves or rejects. `run`
   resolves after `drain`, and after the large-result checkpoint (2.3 step 7). `flush`
   stores the records before it resolves the updates' promises. So the snapshot holds the
   final records. A rejection of `run` gives `"RETRYING"`, and the handler throws the
   same error after the hooks.

Rules:

1. After `terminate`, the SDK sends no checkpoint. A request that is in flight then is
   not awaited, and its response is not stored (section 2.5). So `onInvocationEnd` can run
   before that response arrives. Its snapshot then does not hold those records.
2. `wrap` composes once per invocation. `reduceRight` builds the chain from the
   original `fn` outward, so the first plugin is the outermost.
3. The hooks receive the stored records, not copies. A copy per operation would cost
   time on every checkpoint response. Changing a record is the plugin's mistake
   (rule 1.2). [Do not change operation records](#do-not-change-operation-records)
   documents it.
4. The SDK parses `InputPayload` before the factories, so `info.input` is the workflow's
   `event`. Lambda rejects an invoke whose payload is not JSON. So the parse does not
   throw for an execution that Lambda started.
