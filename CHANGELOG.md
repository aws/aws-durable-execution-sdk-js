# Changelog

All notable changes to the AWS Durable Execution SDK for JavaScript are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Support for JavaScript runtimes that do not provide `async_hooks.AsyncLocalStorage` or
  `util.formatWithOptions`, so durable functions can be deployed on a container image carrying
  a runtime Lambda does not manage (for example [LLRT](https://github.com/awslabs/llrt)).
  Previously, importing `withDurableExecution` on such a runtime threw at module load.

  Both capabilities are feature-detected, so this changes nothing on a managed Node.js runtime.
  Checkpointing and replay are unaffected and checkpoint data is unchanged; what degrades is
  observability, and the SDK now emits one warning per execution environment describing exactly
  what. See "Runtime requirements" in the SDK README for the details, including the replayed-log
  behaviour that carries a CloudWatch cost on long executions.

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

### Fixed

- `waitForCondition` no longer discards checkpointed state when a custom serdes fails to
  deserialize it on a resumed invocation. Previously the restore path caught the
  deserialization error and silently fell back to `initialState`, so the condition loop
  restarted from scratch and the operation could succeed carrying a result computed from
  the wrong state. That path now goes through the same `safeDeserialize` helper the rest
  of the SDK already used, which terminates the invocation with `SERDES_FAILED` instead.

  This is a behaviour change for anyone whose custom serdes can fail while restoring
  state: such an execution now terminates rather than continuing from `initialState`.
  Termination is retryable at the service level, so a transient serdes failure is not
  permanently fatal.

- **eslint-plugin** (`1.1.0`): false positives in `no-closure-in-durable-operations` and
  `no-non-deterministic-outside-step`.
  - A non-deterministic function no longer taints unrelated same-named functions in other
    scopes. Callees are resolved through scope analysis rather than by bare identifier name.
  - Mutating a variable that **shadows** an outer one inside a nested function is no longer
    reported.
  - A named function expression assigning to **its own name** is no longer reported.
  - Mutating a variable from a **destructured declaration** (`let { total } = event`) or one
    declared in an **outer nested block** is now correctly reported rather than missed.

## [2.0.0]

First major release. Upgrade target for users on the `1.x` line (last release:
`1.1.7`). `2.0.0` ships six categories of change:

1. **`withRetry`** — a new helper for retrying a chunk of durable logic
   (multi-operation blocks containing `waitForCallback`, `invoke`, etc.) with a
   configurable backoff strategy.
2. **Linear retry strategy** — `createLinearRetryStrategy` and the new
   `retryPresets.linear` preset for fixed-increment backoff alongside the
   existing exponential strategies.
3. **Serdes upgrades** — `context.configureSerdes()` for setting default serdes
   once, `createFileSystemSerdes` for offloading large payloads to a durable
   mount (Amazon S3 Files, EFS), and inline previews to keep PII out of
   `GetDurableExecutionHistory` and the AWS console.
4. **Cost / scale knob for batch operations** — `NestingType.FLAT` on `map`
   and `parallel` skips the per-iteration `CONTEXT` operation for up to 2x cost
   reduction and up to 2x more iterations per execution, trading per-branch
   observability for throughput.
5. **More precise error types** — promise combinators and callbacks throw
   specific error subclasses (`PromiseCombinatorError`, `CallbackExternalError`,
   `CallbackTimeoutError`, `CallbackSubmitterError`). This is the main source of
   breaking changes for code that branches on error type.
6. **Observability plugins (experimental)** — a `DurableInstrumentationPlugin`
   interface for emitting custom instrumentation. This API is experimental and
   may change in a backward-incompatible way in any release.

A number of operational fixes and security updates are also included.

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
> operations rather than `STEP` operations. See the "Changed" section below.

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

### Added

#### `withRetry` — retry a block of durable logic

A new helper for retrying chunks of logic that contain operations a `step`
cannot host (e.g. `waitForCallback`, `invoke`). Semantically a
`runInChildContext` with a retry policy wrapped around it.

```typescript
import { withRetry, createRetryStrategy } from "@aws/durable-execution-sdk-js";

const result = await withRetry(
  context,
  "approval",
  (ctx, attempt) =>
    ctx.waitForCallback(`approval-${attempt}`, submitter, {
      timeout: { hours: 24 },
    }),
  {
    retryStrategy: createRetryStrategy({
      maxAttempts: 3,
      initialDelay: { seconds: 2 },
      backoffRate: 2,
    }),
  },
);
```

#### `createLinearRetryStrategy` + `retryPresets.linear`

Linear backoff with a configurable initial delay and increment.

```typescript
import {
  createLinearRetryStrategy,
  retryPresets,
} from "@aws/durable-execution-sdk-js";

// Custom: 8 attempts, starting at 2s, +3s each attempt -> 2,5,8,11,14,17,20s
const strategy = createLinearRetryStrategy(8, 2, 3);
await context.step("flaky", fn, { retryStrategy: strategy });

// Or use the new preset (6 attempts: 1,2,3,4,5s)
await context.step("flaky", fn, { retryStrategy: retryPresets.linear });
```

#### `context.configureSerdes()` + `SerdesConfig`

Set default serdes once on the context instead of passing `serdes:` to every
operation. Defaults flow into `step`, `runInChildContext`, `invoke`, and
`waitForCondition`. Callbacks (`createCallback`, `waitForCallback`) require an
**explicit** `defaultCallbackDeserializer` — they keep the passthrough
deserializer otherwise so customer-provided callback payloads aren't accidentally
JSON-parsed. Per-operation `serdes:` arguments still win over the default.

#### `createFileSystemSerdes(basePath, config?)`

A built-in `Serdes` that writes each value to a file under `basePath` and stores
only a small file pointer in the checkpoint, keeping executions under the
per-checkpoint size limit (~256KB) when individual operations produce large
results. Supports `FileSystemSerdesMode.ALWAYS` (default) and
`FileSystemSerdesMode.OVERFLOW` (inline JSON until a threshold, then spill to a
file).

> **⚠ Use a durable, shared mount.** S3 Files (Lambda S3 mount) and EFS are
> supported. **Do not point this at Lambda's `/tmp`** — `/tmp` is
> per-execution-environment and a replay on a different sandbox won't find the
> file, breaking deserialization.

It also accepts an optional `generatePreview` function (with the `buildPreview`
helper plus `PreviewMode`, `FieldMatchMode`) to store a redacted inline preview
in the checkpoint while keeping the full value on disk — useful for keeping PII
out of `GetDurableExecutionHistory` and the AWS console.

#### `NestingType` for `map` and `parallel`

Trade observability for cost on batch operations. The default is
`NestingType.NESTED` (existing behavior), so **existing code is unaffected unless
you opt in**. `NestingType.FLAT` skips per-iteration `CONTEXT` operations for up
to 2x cost reduction and higher per-execution scale, at the price of less
detailed history.

#### `errorMapper` on `ChildConfig`

`runInChildContext`, promise combinators, and `withRetry` accept a function to
remap the thrown error type — useful when you want a domain error class instead
of `ChildContextError`.

#### Instrumentation plugin system (experimental)

> **⚠ Experimental.** This API is unstable and may change in a backward-
> incompatible way in any future release, including minor and patch versions. It
> is not covered by semantic versioning guarantees yet. Use with caution in
> production and pin your SDK version if you depend on it.

A new `DurableInstrumentationPlugin` interface with lifecycle hooks for
execution, invocation, operation, and attempt-level events, composed by a plugin
runner and wired through the entire execution path (`step`, `runInChildContext`,
`invoke`, `wait`, `waitForCondition`, callbacks). Register plugins via the new
`plugins` field on `DurableExecutionConfig`. Plugin errors are isolated
(fire-and-forget) and can never alter customer output.

#### Safe `DurableContext` detection

`DurableContextImpl` now carries a package-namespaced
`Symbol.for("@aws/durable-execution-sdk-js/durable-context")` brand and a
`Symbol.toStringTag` of `"DurableContext"`, so external libraries can detect a
durable context without importing the SDK or relying on name checks.

### Changed

- **Promise combinators no longer block Lambda termination during idle waits.**
  `context.Promise.all`, `Promise.allSettled`, `Promise.any`, and `Promise.race`
  previously ran each branch inside an internal `ctx.step`. A step keeps the
  Lambda invocation alive, so when every branch was idle (e.g. all waiting on a
  `wait` or `waitForCallback`) the function could not be torn down and you kept
  paying for idle compute. The combinators are now implemented on top of
  `runInChildContext`, which lets Lambda terminate while all branches are idle
  and resume on a later invocation.

  **Consequence — execution history shape changes.** Because each branch now runs
  in a child context instead of a step, `GetDurableExecutionHistory` (and the AWS
  console) now show a `CONTEXT` operation per branch instead of a `STEP`
  operation. Anything that parses history or asserts on operation types/counts
  for code using promise combinators must be updated. This change is also what
  enables the typed `PromiseCombinatorError` (upgrade guide §1).

- **UserAgent header** uses `aws-durable-execution-sdk-js/<version>` and appends
  `-bundled` when running from the Lambda bundled runtime path.

### Fixed

- **`errorData` is preserved across nested `runInChildContext` boundaries.**
  `DurableOperationError.toErrorObject` now walks the cause chain (bounded to 10
  hops) to surface the first `errorData` it finds, instead of dropping it each
  time an error is re-wrapped in a fresh `ChildContextError`.
- **Child context result matches replay on first run**, including serdes handling
  in batch operations.
- **`PromiseCombinatorError` survives replay.** It was missing from
  `DurableOperationError.fromErrorObject`, so it deserialized as `StepError` on
  replay, breaking `instanceof` checks and error-identity determinism.
- **`buildPreview` no longer leaks excluded subtrees.** A field excluded via
  `FieldMatchMode.PATH` still had its descendant leaves surface under
  `INCLUDE_ALL` mode, leaking PII into `GetDurableExecutionHistory`. Excluded
  nodes now skip recursion entirely.
- **`createFileSystemSerdes` OVERFLOW threshold accounts for double-encoding.**
  The check now measures the final persisted envelope (`{ data: <json> }`, which
  re-escapes quotes/backslashes and inflates size 10–30%) rather than the raw
  inline JSON, so boundary payloads correctly overflow to file and stay under the
  ~256KB checkpoint limit.
- **Interrupted step with `shouldRetry: false` no longer crashes on replay.**
  An `AtMostOncePerRetry` step interrupted (e.g. Lambda timeout) whose retry
  strategy declines a retry now passes the required metadata when marking the
  operation complete, instead of throwing `metadata required on first call` on a
  fresh Lambda instance.
- **eslint-plugin**: remove `context.getSourceCode()` so the plugin works on
  ESLint v10.
- **sdk**: resolve ESLint warnings surfaced during the build.
- **examples**: prevent duplicate `DeleteFunction` calls during cleanup in
  integration tests.

### Security

- Bump `@aws-sdk/*` deps to pull in the patched `fast-xml-parser`.
- Resolve high-severity advisories in `fast-xml-parser`, `handlebars`, `flatted`,
  `lodash`, `minimatch`, `picomatch`, and `vite`; update `eslint-plugin-tsdoc` to
  `^0.5.2`.

[2.0.0]: https://github.com/aws/aws-durable-execution-sdk-js/compare/sdk-1.1.7...sdk-2.0.0
