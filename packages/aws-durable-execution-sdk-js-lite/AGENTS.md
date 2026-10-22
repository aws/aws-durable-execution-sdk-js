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
- Early completion in `map` and `parallel` (`minSuccessful`, tolerated failures, fail-fast).
- `ctx.promise.all/allSettled/any/race`. The README documents the replacement pattern.
- Linear retry, retry presets, `withRetry`, `createWaitStrategy`.
- The `Duration` object. All times are plain seconds.
- `NestingType.FLAT` / virtual contexts, summary generators, file-system serdes.
- Error subclasses. One error class exists (section 2.7).

### 1.7 API shape

1. Every operation takes exactly one argument. The argument is an object with named keys.
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
   Region comes from `AWS_REGION`.
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

### 2.5 Checkpoints and suspension

Checkpoint queue:

1. Each checkpoint token works once. Each response carries the next token. So only one
   checkpoint request is in flight at a time.
2. `execution.checkpoint(update)` adds the update to a pending list and returns a promise. The
   promise resolves when the request that carried the update succeeds.
3. When no request is in flight, the SDK sends all pending updates in one request, at most 250.
4. After each response, the SDK stores the new token. It replaces each returned operation in
   the local state, keyed by `Id`. Operations read service-assigned fields from that state, for
   example `CallbackDetails.CallbackId`.
5. A response without a `CheckpointToken` means a newer invocation took over. The SDK returns
   PENDING. The one exception is a request that carried the `EXECUTION` update from 2.3 step 6.

Suspension:

1. An operation is blocked when its result needs the service to act first: a wait that has not
   ended, a callback that has not completed, an invoke that has not finished, or a step retry
   that is scheduled.
2. A blocked operation returns a promise that never resolves. It increments the execution's
   blocked count.
3. While a step function or a `waitForCondition` check runs, the execution's running count is
   above zero.
4. The execution suspends when all of these hold: the running count is 0, no checkpoint is
   pending or in flight, and the blocked count is above 0.
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
4. Every operation returns `JSON.parse(JSON.stringify(value))` on the first run, the same
   value it returns on replay. So the first run and a replay see the same data.

### 2.7 Errors

1. The wire format is `ErrorObject = {ErrorType, ErrorMessage, ErrorData}`. Stack traces are not
   sent.
2. A failed operation always throws `DurableOperationError`. Its fields are `errorType`,
   `message`, `data` and `cause`.
3. On the first run, the SDK builds the thrown error from the same `ErrorObject` it
   checkpointed. So the first run and a replay throw the same error.
4. `errorType` is the original error's `name` (for example `"TypeError"`), or a fixed value when
   the SDK creates the error, for example `"CallbackTimeoutError"`.

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

Each operation's file states its replay table in a comment at the top.

### 2.10 Logging

`ctx.logger` has `debug`, `info`, `warn` and `error`. Each forwards to the same `console`
method. It is silent while `ctx.replaying` is true. A step function receives a logger that is
never silent, because a completed step does not run again.
