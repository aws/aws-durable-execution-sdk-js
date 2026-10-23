# Durable Execution SDK Lite: rules and design

This file is for both people and AI agents who change this package. Read it before you
change any file here.

The lite SDK is a small rewrite of `@aws/durable-execution-sdk-js`. It runs the same durable
functions on the same Lambda durable execution service. It has far less code. When this file
and the full SDK disagree, this file wins inside this package.

## 1. Rules

### 1.1 Simplicity first

1. Keep the logic simple. Option B is simpler than option A. Option B loses a minor feature of
   option A. Then choose option B.
2. Do not add a mechanism only to make a rare case faster. Correctness is required. Speed in
   rare cases is not.
3. Do not add configuration that nobody asked for.

### 1.2 Best practices instead of safeguards

1. Developers use this SDK. Attackers do not. So the SDK does not protect developers from
   their own mistakes.
2. Do not add runtime checks for developer misuse. Examples of checks we do not add: argument
   type validation, detecting a parent `ctx` used inside a child, limits on concurrency values.
3. Instead, write the correct usage in the "Best practices" section of `README.md`.
4. One exception exists. Replay validation (section 2.6) stays. It turns a silent wrong
   result into a clear failure. It costs about 10 lines.

### 1.3 No dependencies

1. `package.json` has no `dependencies`, no `devDependencies`, no `peerDependencies`, and no
   `optionalDependencies`.
2. Use only Node.js built-in modules, imported with the `node:` prefix.
3. Do not import `@aws-sdk/*`. The package signs and sends its own HTTP requests (section 2.2).
4. Tests use `node:test` and `node:assert/strict`. Run them with `node --test`.
5. The repository root has tooling such as Biome. That tooling is not a dependency of this
   package. Do not reference it from this package's `package.json`.

### 1.4 No build step

1. The source is plain ES module JavaScript (`.js`). `package.json` sets `"type": "module"`.
2. Types are hand-written in `src/index.d.ts` and `src/testing/index.d.ts`. Update them in the
   same change as the code they describe.
3. Node does not strip TypeScript types inside `node_modules`. So the package cannot ship
   `.ts` files.
4. Minimum Node version is 22.12. From that version, CommonJS code can `require()` this
   package. So the package ships no CommonJS build. Do not use top-level `await`, because it
   prevents `require()`.

### 1.5 No async context and no module state

1. Do not import `node:async_hooks`. Do not use `AsyncLocalStorage` or `AsyncResource`.
2. Pass state explicitly. Each invocation creates one execution object. Each `ctx` holds a
   reference to it.
3. Do not keep per-invocation state in module-level variables. Lambda Managed Instances can
   run several invocations in one Node process at the same time. Module-level state would be
   shared between them.

### 1.6 Out of scope

These features of the full SDK are not in the lite SDK. Do not add them without a decision
from the package owner.

- Plugins, OpenTelemetry hooks, and external or custom loggers.
- Custom serdes. Every value is stored as JSON.
- In-invocation timers and polling. Section 2.5 explains the effect.
- `ctx.promise.all/allSettled/any/race`. The README documents the replacement pattern.
- Linear retry, retry presets, `withRetry`, `createWaitStrategy`.
- The `Duration` object. All times are plain seconds.
- `NestingType.FLAT` / virtual contexts, custom summary generators, file-system serdes.
- Error subclasses. One error class exists (section 2.7).
- The `completeBatch()` and `continueBatch()` helpers and the `CompletionOutcome` enum.
  The `shouldComplete` predicate of `map` and `parallel` is in scope (section 2.9). It
  returns a plain object.

### 1.7 API shape

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

### 1.8 Code style

1. Small files with one concern each. Prefer functions and plain objects over classes. The
   error class is the exception.
2. Comments explain why, in short sentences: the fact, then the consequence, then the decision.
3. Every behavior has a test. Tests live in `test/` and end in `.test.js`.
4. Before a commit, run `npm test` in this folder and `npx biome check
   packages/aws-durable-execution-sdk-js-lite` from the repository root. Both must pass.
5. Commit titles use the scope `sdk-lite`, for example `feat(sdk-lite): add wait`.

## 2. Design

### 2.1 Files

```
src/index.js               public exports
src/index.d.ts             public types
src/with-durable-execution.js   Lambda handler wrapper
src/execution.js           per-invocation state, checkpoint queue, suspension
src/context.js             the ctx object and operation ids
src/errors.js              DurableOperationError and ErrorObject conversion
src/retry.js               createRetryStrategy
src/logger.js              replay-aware console logger
src/operations/*.js        one file per operation
src/transport/sigv4.js     SigV4 signing with node:crypto
src/transport/lambda-client.js  HTTPS client for the two durable APIs
src/testing/*.js           local test runner (subpath export "./testing")
test/*.test.js             tests
```

### 2.2 Service API

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
   and `message`.
6. The client is an object with two async methods: `checkpoint(request)` and
   `getExecutionState(request)`. Requests and responses use the API field names above. Tests
   and the local runner replace the client through `withDurableExecution(handler, { client })`.

### 2.3 Invocation flow

1. Lambda calls the wrapped handler with `{DurableExecutionArn, CheckpointToken,
   InitialExecutionState: {Operations, NextMarker}}`.
2. The SDK loads the remaining pages with `GetDurableExecutionState` until `NextMarker` is
   empty. If a page request fails, the SDK throws from the Lambda handler, so Lambda invokes
   again.
3. The first operation is the `EXECUTION` operation. The user event is
   `JSON.parse(ExecutionDetails.InputPayload)`, or `{}` if the payload is empty.
4. The SDK calls `handler({ event, ctx, lambdaContext })`.
5. The SDK returns one of these objects to Lambda:
   - `{Status: "SUCCEEDED", Result: JSON.stringify(value)}`. `Result` is absent for
     `undefined`.
   - `{Status: "FAILED", Error: ErrorObject}`.
   - `{Status: "PENDING"}`.
6. If `Result` is larger than `6 * 1024 * 1024 - 50` bytes, the SDK checkpoints
   `{Type: "EXECUTION", Action: "SUCCEED", Payload: Result}` first. It then returns
   `{Status: "SUCCEEDED", Result: ""}`. The full SDK gives this update the id
   `"execution-result-" + Date.now()`, hashed. The lite SDK does the same.
7. If the SDK throws from the Lambda handler, Lambda records an invocation error and the
   service invokes the function again. The SDK throws only for errors that a new invocation
   can fix (section 2.8).

### 2.4 Operation ids

1. Each `ctx` has a counter that starts at 0.
2. Each operation call increments the counter synchronously, at call time, before any `await`.
3. The raw id is `String(n)` in the root context. In a child context it is
   `` `${childRawId}-${n}` ``.
4. The id sent to the service is the first 16 hex characters of the MD5 hash of the raw id.
   `ParentId` is the hashed raw id of the enclosing child context. Root operations have no
   `ParentId`.
5. These ids must match the full SDK exactly. The service and saved executions depend on them.
6. MD5 is the main CPU cost of an operation. So each ctx hashes each raw id once and keeps the
   hash in a map. It hashes its parent id once, when the ctx is created.

### 2.5 Checkpoints and suspension

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
   character of a developer string, and 600 bytes for keys and numbers. So the real body is
   never larger than the limit. The bound is about 2 times the real size for a large
   payload, so a request can carry about 2.5 MiB of payloads. The 1 MiB margin also leaves
   room for the HTTP headers.
   The first update is always taken, so an update larger than the limit goes alone. The rest
   wait for the next request.
4. After each response, the SDK stores the new token. It replaces each returned operation in
   the local state, keyed by `Id`. Operations read service-assigned fields from that state, for
   example `CallbackDetails.CallbackId`.
5. A response without a `CheckpointToken` means a newer invocation took over. The SDK returns
   PENDING. The one exception is a request that carried the `EXECUTION` update from 2.3 step 6.

Suspension:

1. An operation is blocked when its result needs the service to act first: a wait that has not
   ended, a callback that has not completed, an invoke that has not finished, or a step retry
   that is scheduled.
2. A blocked operation returns a promise that never resolves. It adds a liveness check to the
   execution's blocked list. The check turns false when a batch abandons the operation
   (section 2.9).
3. While a step function or a `waitForCondition` check runs, the execution's running count is
   above zero.
4. The execution suspends when all of these hold: the running count is 0, no checkpoint is
   pending or in flight, and at least one blocked operation is live. An abandoned operation
   must not count. Otherwise the invocation could suspend while the workflow awaits
   something else, and nothing that the workflow awaits would wake it.
5. The SDK checks the condition again after one `setImmediate`. This lets already-resolved
   promises start the next operation first. If it still holds, the invocation returns PENDING.
6. After the SDK decides to return PENDING, every later `checkpoint` call returns a promise that
   never resolves. So user code cannot run more side effects in this invocation.
7. After the handler returns or throws, the execution never suspends. An un-awaited blocked
   operation must not turn a finished handler into PENDING. So the SDK counts the finished
   handler as running while it saves the remaining checkpoints.
8. The SDK has no timers and does not poll. Effect: a branch whose wait ends while another
   branch runs a step continues only in the next invocation. This is accepted (rule 1.1).

### 2.6 Replay

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
   (README "Return JSON-safe values"). The SDK does not check it, because a check costs a
   parse on every operation.

### 2.7 Errors

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

### 2.8 Checkpoint error handling

1. HTTP 4xx other than 429, with name `InvalidParameterValueException` and a message starting
   with `"Invalid checkpoint token"`: throw from the Lambda handler. A new invocation gets a new
   token.
2. Any other HTTP 4xx except 429: return FAILED.
3. Names starting with `KMS` and ending with `Exception`: return FAILED.
4. Everything else, including 429, 5xx and network errors: throw from the Lambda handler.

### 2.9 Operations

| Operation | Wire Type / SubType | Updates the SDK sends |
|---|---|---|
| `step` | `STEP` / `Step` | `START`, then `SUCCEED`, `RETRY` or `FAIL` |
| `wait` | `WAIT` / `Wait` | `START` with `WaitOptions.WaitSeconds` |
| `createCallback` | `CALLBACK` / `Callback` | `START` with `CallbackOptions` |
| `waitForCallback` | `CONTEXT` / `WaitForCallback` | child context with a callback and a step |
| `invoke` | `CHAINED_INVOKE` / `ChainedInvoke` | `START` with `Payload` and `ChainedInvokeOptions` |
| `waitForCondition` | `STEP` / `WaitForCondition` | `START`, then `RETRY` with `Payload`, `SUCCEED` or `FAIL` |
| `runInChildContext` | `CONTEXT` / `RunInChildContext` | `START`, then `SUCCEED` or `FAIL` |
| `map` | `CONTEXT` / `Map`, items `MapIteration` | child contexts |
| `parallel` | `CONTEXT` / `Parallel`, branches `ParallelBranch` | child contexts |

The SubType column shows the defaults. `step`, `createCallback` and `runInChildContext`
accept a `subType` option that replaces the default, as in the full SDK. An empty string
selects the default. The SDK does not validate the value (rule 1.2). The README documents
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
4. Code that did not wait for a checkpoint can keep running after the invocation's outcome is
   decided. So a step checks `execution.done` before it runs `fn`, and never runs `fn` after
   that.

Child contexts (`runInChildContext`, `waitForCallback`, `map`, `parallel`):

1. The service drops the children of a completed context from the state. So a SUCCEEDED or
   FAILED context returns its stored result or error. It does not run `fn` again, because
   its steps would run again.
2. A result larger than `256 * 1024` bytes does not fit in a checkpoint. The SDK sends
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

1. A batch is a child context. Each item is a child context of the batch. Items start in
   index order, so item i always has the raw id `` `${batchId}-${i + 1}` ``.
2. `completionConfig` follows the full SDK. It holds thresholds or a `shouldComplete`
   predicate. After each item settles, the batch checks it. With no threshold set, one
   failure completes the batch (fail fast). The README lists the rules.
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

### 2.10 Logging

`ctx.logger` has `debug`, `info`, `warn` and `error`. Each forwards to the same `console`
method. It is silent while `ctx.replaying` is true. A step function receives a logger that is
never silent, because a completed step does not run again.
