# SDK 3.1.0 / Testing SDK 1.4.0 / ESLint plugin 2.0.0

This release contains Core 3.1.0, Testing SDK 1.4.0 and ESLint plugin 2.0.0.
The other packages have no change for users, so they keep their versions.

# @aws/durable-execution-sdk-js 3.1.0

## What's Changed

- feat(sdk): `createRetryStrategy` has a new experimental option `pauseEvery`.
  A step pauses the execution on attempts `pauseEvery`, 2 x `pauseEvery` and so
  on. Use it for long retry delays of 30 s or more, with `HALF` or `NONE`
  jitter. by @ParidelPooya in #1253
- feat(sdk): the step context has an `AbortSignal` in `ctx.signal`. The SDK
  aborts it when a `map` or `parallel` no longer needs the item, when the
  invocation terminates, and when the invocation returns. by @ParidelPooya in
  #1193
- fix(sdk): the SDK ends the invocation at its deadline with
  `InvocationDeadlineError`. Lambda retries the invocation, and the execution
  does not fail. After a termination, no new operation starts. This matters on
  Lambda Managed Instances, where a timeout does not stop the code. by
  @ParidelPooya in #1202
- fix(sdk): no checkpoint is sent after the invocation ends. by
  @itsrayeedscodespace in #1114
- fix(sdk): `createFileSystemSerdes().deserialize` builds the file path from
  `basePath`, the execution and the entity. It no longer reads the path stored
  in the checkpoint. by @ParidelPooya in #1219
- fix(sdk): `context.logger.error(err)` keeps the `cause` of the error. by
  @ParidelPooya in #1199
- fix(sdk): ESM consumers get ESM types, and the declaration maps resolve.
  Invalid input to `map`, `parallel` and `waitForCondition` throws `TypeError`.
  The messages do not change. by @ParidelPooya in #1216
- fix(sdk): `@types/aws-lambda` is a dependency, so the published types
  resolve `Context`. The published types leave out test files and `@internal`
  symbols. by @ParidelPooya in #1179, #1180
- fix(sdk): `CheckpointUnrecoverableInvocationError`,
  `CheckpointUnrecoverableExecutionError` and `SerdesFailedError` keep their
  name in a minified build. by @ParidelPooya in #1185
- docs(sdk): rules for running on Lambda Managed Instances, and README and
  TSDoc fixes. by @ParidelPooya in #1195, #1224

### Deprecations

- `WaitStrategyConfig.timeoutSeconds`. The wait strategy never read it. Limit
  the total wait with `maxAttempts`, `initialDelay`, `maxDelay` and
  `backoffRate`. #1224

**Full Changelog**: [sdk-3.0.0...sdk-3.1.0](https://github.com/aws/aws-durable-execution-sdk-js/compare/sdk-3.0.0...sdk-3.1.0)

# @aws/durable-execution-sdk-js-testing 1.4.0

## What's Changed

- feat(test): the local test runner supports `pauseEvery`. A step that pauses
  marks the local execution paused, and `runner.resumeExecution()` continues
  it. The runner handles the new `ExecutionPaused` and `ExecutionResumed`
  history events. by @ParidelPooya in #1253

**Full Changelog**: [sdk-3.0.0...sdk-3.1.0](https://github.com/aws/aws-durable-execution-sdk-js/compare/sdk-3.0.0...sdk-3.1.0)

# @aws/durable-execution-sdk-js-eslint-plugin 2.0.0

## What's Changed

- feat(eslint-plugin): the new rule `valid-operation-identifiers` reports an
  operation name or `subType` that the service rejects. by @ParidelPooya in
  #1159

### Breaking Changes

- `recommended` and `flat/recommended` turn the new rule on as an error. So the lint of an
  existing project can fail after the upgrade. It fails only on a call that
  already fails the execution whenever it runs.

**Full Changelog**: [sdk-3.0.0...sdk-3.1.0](https://github.com/aws/aws-durable-execution-sdk-js/compare/sdk-3.0.0...sdk-3.1.0)
