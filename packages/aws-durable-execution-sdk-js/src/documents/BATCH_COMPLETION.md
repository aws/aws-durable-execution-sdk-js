# Batch early completion

How `map()` and `parallel()` complete before every item has finished, and what happens to the remaining items.

A `map()` or `parallel()` completes early when its completion rule is met before every item has finished. With no `completionConfig`, the rule is fail-fast: the first failure completes the batch. `minSuccessful`, `toleratedFailureCount`, `toleratedFailurePercentage` and `shouldComplete` set other rules. Setting any of them replaces fail-fast.

The batch checks its rule each time an item's result reaches it. Once the rule is met, the remaining items are abandoned:

- An item that is running is reported as `STARTED`. It is not counted in `successCount` or `failureCount`.
- An item that had not started, because of `maxConcurrency`, does not appear in `all`.
- The batch does not wait for abandoned items and does not stop them by force. When the batch's context finishes, an abandoned item can stop in two ways:
  - **Cooperative abort.** The SDK aborts the `ctx.signal` of the item's steps. A step that passes its signal to its I/O calls, or checks it in its loops, stops when the signal aborts. With `NestingType.FLAT`, the item's steps share the signal of the batch's context, and the SDK aborts that signal too.
  - **Dropped checkpoint.** The SDK drops the item's checkpoints. Code that ignores the signal stops only when it awaits a dropped checkpoint.

  Until the item stops, its code can keep running while the invocation is active, and its side effects can happen. Nothing waits for it, so the invocation can end first:
  - A step whose function is running keeps running while the invocation is active. It is not guaranteed to finish. If it finishes after the batch's context, its result is not recorded.
  - A new `step` with the default `StepSemantics.AtLeastOncePerRetry` runs its function once, and the history has no record of it. A new `waitForCondition` runs its check function once. The item then stops.
  - `runInChildContext` does not await its own checkpoints. So its function runs, and the operations inside it follow these rules.
  - A new `wait`, `invoke`, `createCallback`, `waitForCallback`, or step with `StepSemantics.AtMostOncePerRetry` stops the item before it takes effect. "New" means the item starts it after the batch's context finished. An operation started earlier may already have recorded its start and taken effect.

What happens next depends on what the handler does after the batch:

- If the handler returns, the invocation can end while abandoned code still runs. That code is then not guaranteed to finish.
- If the handler waits, for example on a `wait` or a callback, the invocation cannot suspend while an abandoned step function or `waitForCondition` check is still running. Such an operation counts as running until its function returns and its dropped checkpoint releases it. So a slow abandoned function keeps the invocation active, which adds to its duration and cost.

An abandoned item can record its outcome before the batch's context finishes. This includes an item that recorded its outcome before the item that completed the batch, but whose result reached the batch later. The execution history then shows its child context as `SUCCEEDED` or `FAILED`, while the `BatchResult` reports it as `STARTED`. With `NestingType.FLAT`, the item has no child context, and the history shows its operations instead.

The handler receives only the `BatchResult`. Replay returns the same completed items and the same `completionReason`. Replay can omit the `STARTED` items, so `started()`, `startedCount` and `totalCount` can differ after replay. So base decisions on the completed items, and do not reconcile the `BatchResult` with the execution history.

To get the result of every item, use a rule that cannot complete early. Set `toleratedFailurePercentage: 100`, and leave `minSuccessful`, `toleratedFailureCount` and `shouldComplete` unset. The batch then waits for every item. Failed items appear in `failed()`. The call does not throw, so call `throwIfError()` if a failure must stop the handler:

```typescript
const results = await context.map("process-all", items, processItem, {
  completionConfig: { toleratedFailurePercentage: 100 },
});
const failures = results.failed(); // every failed item, with its error
```
