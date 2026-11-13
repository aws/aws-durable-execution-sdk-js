# Changelog

This file lists the breaking changes and deprecations of the AWS Durable Execution SDK for
JavaScript packages. A breaking change is a change that can make code, configuration, IAM
policies or tests that worked on the previous version fail or behave differently. Each
[GitHub Release](https://github.com/aws/aws-durable-execution-sdk-js/releases) lists every change in that release.

A pull request that makes a breaking change or a deprecation adds an entry under
`[Unreleased]`. Each release moves those entries under its own version heading. Versions that
are not listed here have no breaking changes or deprecations.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Telemetry MCP 1.1.0.** `test_destination` and blocked data-tool results no longer return a
  `writeAccess` field. The server no longer checks the credentials. It asks you to confirm, once
  per session, that giving it read-only credentials is your responsibility. See the
  [release notes](release-notes/telemetry-mcp-1.1.0.md).

- **Breaking (experimental).** `@aws/durable-execution-sdk-js-microvm-worker` is renamed to
  `@aws/durable-execution-sdk-js-compute-worker`. The MicroVM worker is in the `./microvm`
  subpath. Change `from "@aws/durable-execution-sdk-js-microvm-worker"` to
  `from "@aws/durable-execution-sdk-js-compute-worker/microvm"`. The exported names do not change.
  The package root exports only `CallbackReporter` and the other names that every compute type
  shares.

- **Breaking (experimental).** The MicroVM operations in `@aws/durable-execution-sdk-js-extras`
  no longer resume a suspended MicroVM. To suspend a MicroVM, set `idlePolicy` with
  `autoResumeEnabled: true`. The SDK does not resume a MicroVM; the service resumes it on the
  next request. This applies to `autoSuspendOnIdle` and to `suspendAfter`.
  - Set `maxIdleDurationSeconds` above `maximumDurationInSeconds` (the operation timeout plus 5
    minutes). The idle timer counts only inbound requests, so a shorter value suspends a running
    job.
  - Without `autoResumeEnabled`, a job after a suspend fails after its retries with
    `MicrovmDeliveryError`. With the default retry strategy, that takes about 6 minutes.
  - A job that arrives more than about 5 seconds after a suspend takes about 1 s longer.
  - The function's role no longer needs `lambda:ResumeMicrovm`. It needs `lambda:GetMicrovm` for
    HTTP delivery, and `lambda:SuspendMicrovm` for `suspendAfter`.
  - The request step no longer calls GetMicrovm before each job. It calls GetMicrovm only after an
    HTTP 502 with `x-aws-proxy-error: MICROVM_CONNECT_FAILED` or a request without an answer, at
    most once per 2 seconds. A terminating, terminated, or removed MicroVM still fails the job at
    once with `MicrovmNotRunningError`. A `SUSPENDING` or `SUSPENDED` MicroVM keeps the request
    step retrying. The endpoint answers that 502 for about 5 seconds after a suspend, and the
    backoff of the request step outlasts that window. With a `retryWindow` under about 9 seconds,
    the step retry strategy covers the rest of that window, at the cost of one or two more step
    attempts. A job sent right after a suspend can take up to about 10 seconds.
  - The launch checkpoint of a session no longer records `resumeBeforeDelivery`. An execution in
    flight that launched with `autoSuspendOnIdle` or an `idlePolicy` replays a launch checkpoint
    with `"resumeBeforeDelivery": true`. The new code ignores the field. So its next job no longer
    resumes the MicroVM. That job works only if the MicroVM was launched with
    `autoResumeEnabled: true`. Otherwise it fails after its retries with `MicrovmDeliveryError`.
    An execution in flight whose session used `suspendAfter` without an `idlePolicy` is affected
    too: its next job after the suspend no longer resumes the MicroVM and fails after its retries
    with `MicrovmDeliveryError`.
  - The message of the reserve error of the state check now reads: `GetMicrovm for MicroVM <id>
    did not end before the invocation reserve, after <n> ms.`
  - The warning after a failed GetMicrovm now reads: `GetMicrovm failed, so the operation could
    not check whether the MicroVM has ended. The request step keeps sending the job.`

- `microvm` in `@aws/durable-execution-sdk-js-extras` now requires `lambda:GetMicrovm` for HTTP
  delivery.
  A role without `lambda:GetMicrovm` now fails a job whose request gets no answer, even when
  the MicroVM runs, for example a worker that takes more than 10 seconds to listen. Before,
  such a job logged a warning and succeeded.

### Deprecated

- `WaitStrategyConfig.timeoutSeconds` in `@aws/durable-execution-sdk-js`. The wait
  strategy never read it. Limit the total wait with `maxAttempts`, `initialDelay`,
  `maxDelay` and `backoffRate`.

## [3.0.0] - 2026-10-26

Core 3.0.0, OTel 2.0.0 and Testing SDK 1.3.2 release together. The
[2.x to 3.0 migration guide](docs/migration-2.x-to-3.0.md) lists the porting steps.

### Changed

- Plugin factories replace plugin instances in `DurableExecutionConfig.plugins`.
  The SDK creates one plugin per invocation. (6597e075)

- OTel reports `faas.max_memory` in bytes, not MiB. (e049d07c)

- `InvokeError.cause.name` is the invoked function's error type. (a0d310f5)

- The idle cooldown before an invocation suspends is 3 ms, not 20 ms. (c0a7e349)

- **Breaking for plugin authors (experimental interface).** The SDK no longer waits for the
  operation plugin hooks: `onOperationStart`, `onOperationEnd`, `onOperationAttemptStart`,
  `onOperationAttemptEnd` and `onOperationChange`. Before, a slow hook delayed the next
  operation. A hook awaited while no operation was running could also let the invocation
  suspend before the caller's next line ran, when another operation such as a callback was
  waiting. The changes:
  - The synchronous part of each hook still runs before the SDK continues, in call order. The
    asynchronous parts of consecutive hooks can overlap. A plugin that needs them in order must
    queue the work itself.
  - Before `onInvocationEnd`, the SDK waits for the asynchronous work of earlier hooks, until
    500 ms before the invocation's deadline. It then waits for `onInvocationEnd`, until 50 ms
    before the deadline. Work still pending is abandoned. Before, a hook that never settled held
    the invocation until the Lambda timeout.
  - `onInvocationEnd` is now called after that drain, not at the moment the invocation ends.
  - `onInvocationStart` and the `wrap` hooks are unchanged.

## [2.7.1] - 2026-10-19

### Changed

- Checkpoint-derived `OperationInfo.error` can be absent when a failed callback
  or invoke has missing wire error data or no defined diagnostic values.
  Instrumentation should use
  `status` to identify failure and `error` for available exception details.
  Caller-facing callback and invoke failures are unchanged.

## [2.7.0] - 2026-10-16

### Changed

- The testing SDK's local checkpoint server now validates checkpoints as the service does. Before,
  it accepted some updates that the service rejects, and it rejected others with different
  messages. So a test could pass locally for a handler that fails in AWS. The changes:
  - The model checks now cover `Id`, `ParentId`, `Name`, `Type`, and `Action`, as well as
    `SubType`. `Id` and `ParentId` must have 1 to 64 characters from `[a-zA-Z0-9-_]`. `Name` must
    have 1 to 256 printable ASCII characters. `Id`, `Type`, and `Action` are required. An invalid
    member rejects the whole request with HTTP 400 `ValidationException`, with the service's
    message. The message lists at most 10 errors, as the service's does.
  - The model checks also cover the options. `ChainedInvokeOptions.FunctionName` is required, and
    must be a Lambda function name, a qualified name, or a function ARN of at most 256 characters.
    `WaitOptions.WaitSeconds` and `StepOptions.NextAttemptDelaySeconds` must be from 1 to
    31622400. The `CallbackOptions` timeouts must be from 0 to 99999999.
  - A member of the wrong JSON type rejects the request with HTTP 400 `SerializationException`,
    with the service's message. The check covers every member of `OperationUpdate`, including
    `Payload`, the `Error` members, and `ContextOptions.ReplayChildren`. For example, a step that
    throws `{ name: "X", message: 1 }` now fails the checkpoint, as it does in AWS. The service
    reads an integer member without its fractional part. So `WaitSeconds: 1.5` is accepted as 1,
    and `WaitSeconds: 0.5` is rejected as 0. The local server also stores and schedules that
    integer, as the service applies it. So `context.wait({ seconds: 1.5 })` waits and records 1
    second.
  - A callback timeout or heartbeat timeout of 0 means no timeout, as it does in the service. The
    local server timed the callback out at once.
  - An update for an existing operation must not change its `Type`, `SubType`, `Name`, or
    `ParentId`. A different value usually means that the handler is not deterministic.
  - The error object limit is 262144 bytes, the service's limit. It was 32768 bytes.
  - Payloads now have the service's limits: 262144 bytes for STEP and CONTEXT output, 1048576
    bytes for CHAINED_INVOKE input, and 6291456 bytes for EXECUTION output. So a handler result
    over 6291456 bytes now fails the checkpoint, as it does in AWS.
  - A CALLBACK and a CHAINED_INVOKE accept only `START`. The local server accepted `CANCEL`.
  - A WAIT `START` requires `WaitOptions`. A CHAINED_INVOKE `START` requires
    `ChainedInvokeOptions`.
  - The error messages are the service's. For example, "Cannot start a WAIT that already exists."
    is now "Cannot start a WAIT operation that already exists.". A test that matches the old
    message text must update it.
  - A validation failure now carries HTTP status 400, as the service's `InvalidParameterValueException`
    does. The SDK classifies a 4xx checkpoint failure as unrecoverable for the execution. So the
    local execution now ends `FAILED` with `CheckpointUnrecoverableExecutionError`, as it does in
    AWS. Before, the error carried no status, so it failed only the invocation, and `run()` rejected.

## [eslint-plugin 1.1.0]

### Changed

- **eslint-plugin** (`1.1.0`): `no-closure-in-durable-operations` and
  `no-non-deterministic-outside-step` now derive their answers from the scope information ESLint
  computes while parsing, instead of re-walking the AST. Both rules were super-linear in file
  size; the worst case measured 263.9ms on a 400-assignment callback, now 1.8ms.

  Because the rules previously missed cases their own documentation described, upgrading surfaces
  new errors on code that already violated the replay model:
  - Mutating a **module-scope** variable inside a durable operation is now reported. Only
    enclosing _function_ scopes were checked before, so a top-level `let counter = 0`,
    `export let count`, or a `catch` binding was silently allowed. Module-level mutable state
    around a handler is a common pattern, so this is the most likely source of new errors.
  - **Destructuring and for-of assignment targets** are now reported: `[a] = [1]`,
    `({ a } = obj)` and `for (a of xs)`.
  - Calls to a **non-deterministic function declared after the call site** are now reported;
    hoisted declarations were previously skipped.

  One case reports less: assigning a function to a member
  (`obj.method = function () { Date.now(); }`) used to register it under the property name, so a
  call to an unrelated bare `method()` was reported.

## [2.0.0]

First major release. Upgrade target for users on the `1.x` line (last release:
`1.1.7`). The [release notes](https://github.com/aws/aws-durable-execution-sdk-js/releases/tag/sdk-2.0.0)
list the new features and fixes.

### ⚠ Upgrade guide (breaking changes)

#### 1. Promise combinator failures now throw `PromiseCombinatorError`

`context.Promise.all`, `Promise.allSettled`, `Promise.any`, and `Promise.race`
previously rejected with `StepError`. They now reject with
`PromiseCombinatorError`, which extends `DurableOperationError` directly — **not**
`StepError` or `ChildContextError`.

```typescript
// v1.x — no longer matches in v2
try {
  await context.Promise.all([...]);
} catch (err) {
  if (err instanceof StepError) { /* ... */ }
}

// v2.0
import { PromiseCombinatorError } from "@aws/durable-execution-sdk-js";

try {
  await context.Promise.all([...]);
} catch (err) {
  if (err instanceof PromiseCombinatorError) {
    // err.cause is the original failure from the first rejecting branch
  }
}
```

If you don't care about distinguishing the operation type, catch the base class
`DurableOperationError`.

> The error-type change is a side effect of reimplementing combinators on
> `runInChildContext` (so idle branches no longer block Lambda termination). That
> also changes the **execution history shape** — branches now appear as `CONTEXT`
> operations rather than `STEP` operations.

#### 2. Callback failures now form a typed hierarchy under `CallbackError`

`createCallback` and `waitForCallback` previously threw `CallbackError` for every
failure mode. v2 organizes the specific callback errors into a hierarchy and
adds `CallbackExternalError`, which is thrown when the external entity completes a
callback with a failure (via `SendDurableExecutionCallbackFailure`):

```
CallbackError
  +- CallbackExternalError   // external entity reported failure (was CallbackError)
  +- CallbackTimeoutError    // callback timed out
  +- CallbackSubmitterError  // waitForCallback submitter function threw
```

| Scenario                             | v1.x error      | v2 error                 |
| ------------------------------------ | --------------- | ------------------------ |
| Callback completed with `FAILED`     | `CallbackError` | `CallbackExternalError`  |
| Callback timed out (`TIMED_OUT`)     | `CallbackError` | `CallbackTimeoutError`   |
| `waitForCallback` submitter threw    | `CallbackError` | `CallbackSubmitterError` |
| Internal error (e.g. no callback ID) | `CallbackError` | `CallbackError`          |

**`instanceof CallbackError` is safe.** Because `CallbackExternalError`,
`CallbackTimeoutError`, and `CallbackSubmitterError` all extend `CallbackError`,
existing `catch (e) { if (e instanceof CallbackError) ... }` code keeps matching
all callback failures. The break only affects code that relies on the **exact**
`errorType` / `name` string being `"CallbackError"` for external failures or
timeouts.

```typescript
// v2.0 — branch on the specific subtype, or catch the base class
import {
  CallbackError,
  CallbackExternalError,
  CallbackTimeoutError,
  CallbackSubmitterError,
} from "@aws/durable-execution-sdk-js";

try {
  await context.waitForCallback("approval", submitter, {
    timeout: { hours: 1 },
  });
} catch (err) {
  if (err instanceof CallbackTimeoutError) {
    // Approver missed the deadline
  } else if (err instanceof CallbackSubmitterError) {
    // The submitter function (e.g. publishing the approval URL) threw
  } else if (err instanceof CallbackExternalError) {
    // External system completed the callback with FAILED
  } else if (err instanceof CallbackError) {
    // Any other callback failure (base class)
  }
}
```

#### 3. KMS exceptions during checkpoint / state APIs are non-retryable

KMS exceptions during `CheckpointDurableExecution` and `GetDurableExecutionState`
are now treated as non-retryable customer errors instead of being retried.

#### 4. `runInChildContext` applies the serdes round-trip in all modes

`runInChildContext` previously ran `deserialize(serialize(result))` only for
small (checkpointed) payloads; large payloads (replay-children mode) and virtual
contexts returned the raw in-memory result. With a **non-identity** serdes, the
value a caller received depended on payload size or the virtual flag. All three
modes now apply the same round-trip, so callers observe consistent results
regardless of payload size. No public API change, but observed values may change
if you use a serdes whose `deserialize(serialize(x))` differs from `x`.

#### 5. `FileSystemSerdesConfig.mode` renamed to `storageMode`

Only relevant if you adopted `createFileSystemSerdes` during the `2.0.0-alpha`
line; `1.x` users are unaffected.

[Unreleased]: https://github.com/aws/aws-durable-execution-sdk-js/compare/sdk-3.0.0...HEAD
[3.0.0]: https://github.com/aws/aws-durable-execution-sdk-js/compare/sdk-2.7.1...sdk-3.0.0
[2.7.1]: https://github.com/aws/aws-durable-execution-sdk-js/compare/sdk-2.7.0...sdk-2.7.1
[2.7.0]: https://github.com/aws/aws-durable-execution-sdk-js/compare/sdk-2.6.0%2Ftest-1.3.0...sdk-2.7.0
[eslint-plugin 1.1.0]: https://github.com/aws/aws-durable-execution-sdk-js/releases/tag/eslint-1.1.0
[2.0.0]: https://github.com/aws/aws-durable-execution-sdk-js/compare/sdk-1.1.7...sdk-2.0.0
