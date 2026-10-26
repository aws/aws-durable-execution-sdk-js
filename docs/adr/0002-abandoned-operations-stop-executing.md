# ADR 0002: An operation parked on a dropped checkpoint stops counting as `EXECUTING`

Status: proposed. Amends Rule 1 of [ADR 0001](./0001-operation-tracking-and-plugin-hooks.md).

## Definitions

- A finished ancestor is a context whose step id the checkpoint manager has recorded with
  `markAncestorFinished`. Every non-virtual child context becomes one when its function returns
  or throws, and when a completed context is replayed. This includes a `map` or `parallel`
  container and each of its NESTED items, and the child context of `waitForCallback`. A `map`
  or `parallel` container can finish while some of its items still run. A plain
  `runInChildContext` can finish while an operation it started without awaiting still runs.
- A dropped checkpoint is a checkpoint request for a descendant of a finished ancestor.
  `CheckpointManager.checkpoint()` does not send it and returns a promise that never settles.
- An abandoned operation is an operation whose dropped checkpoint its caller awaits. The caller
  never resumes.

## Context

1. ADR 0001 Rule 1 keeps an operation `EXECUTING` until its result is ready for the caller.
2. A step awaits its `SUCCEED`, `FAIL` or `RETRY` checkpoint while it is `EXECUTING`. A
   waitForCondition does the same.
3. If that checkpoint is dropped, the result is never ready. So under Rule 1 the step stays
   `EXECUTING` for the rest of the invocation.
4. The checkpoint manager does not suspend while any operation is `EXECUTING`.
5. So after a `map` or `parallel` completes early, or a child context returns while a step it
   started still runs, a `wait` or callback later in the handler cannot suspend the invocation,
   while the abandoned step is parked. If the wait or callback
   outlasts the remaining invocation time, the invocation runs until the Lambda timeout.

Measured with the local runner on a `map` with `minSuccessful: 1`, whose other items finish their
step after `map()` returns, followed by a 1 s wait: the execution completed in 1 invocation
before this decision, and in 2 after it.

## Decision

When `checkpoint()` drops a checkpoint, the checkpoint manager marks the operation `COMPLETED`
if all of these hold:

- The operation is `EXECUTING`.
- The operation is not a `CONTEXT`.
- The action is `SUCCEED`, `FAIL` or `RETRY`.

Every call site that sends these actions for a non-context operation awaits the checkpoint. So
the caller is parked, and no SDK work for the operation runs after the mark. So Rule 1's purpose
holds: no SDK work runs while the operation is not `EXECUTING`.

Two kinds of caller keep running after a dropped checkpoint. Rule 1 and Rule 2 still apply to
them unchanged:

- A child context queues `SUCCEED` and `FAIL` without waiting. It then runs plugin hooks and
  deserializes its result. Its own code marks it `COMPLETED` when it settles.
- A step or waitForCondition queues `START` without waiting and then runs its function.

The operation stays in the checkpoint manager's operation map, so a later state change for it
still finds its metadata.

Rule 1 therefore reads: an operation stays `EXECUTING` until its result is ready for the caller,
or until it is abandoned as defined above.

## Consequences

- An invocation can suspend while an abandoned operation's caller is parked. The parked
  promise is never resumed in that invocation, and no later invocation re-runs the abandoned
  item, because its finished ancestor returns its recorded result on replay.
- A new handler that awaits `SUCCEED`, `FAIL` or `RETRY` gets this behavior. A new handler
  that sends one of these actions without waiting, while it is `EXECUTING`, and keeps working
  must not be released this way. The release rule would then need the caller to state whether
  it waits, instead of inferring it from the operation type and the action.

## Enforcement

- `src/utils/checkpoint/checkpoint-ancestor.test.ts` covers the release of a step `SUCCEED`,
  `FAIL` and `RETRY`, and of a waitForCondition `SUCCEED` and `RETRY`. It also covers that a
  context `SUCCEED`, a context `FAIL` and a `START` stay `EXECUTING`. `AGENTS.md` lists these
  cases among the tests that guard the invariants.
- `map/early-completion-suspends` in the examples package checks that the wait suspends, locally
  and in cloud integration.
