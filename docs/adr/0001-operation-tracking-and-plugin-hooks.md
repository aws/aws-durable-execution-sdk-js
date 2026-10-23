# ADR 0001: Operations stay active until their result is ready, and plugin hooks never block operations

Status: accepted.

## Definitions

- An invocation is one run of the Lambda handler. A durable execution spans many invocations.
- The checkpoint manager tracks a lifecycle state for each operation. `EXECUTING` means the SDK
  is still doing work for that operation in this invocation. The waiting states mean the
  operation waits for something outside the invocation, such as a callback, a timer or a retry.
- To suspend means to end the invocation with `PENDING`. The service starts a later invocation
  when a waiting operation can make progress.
- The termination cooldown is `CHECKPOINT_TERMINATION_COOLDOWN_MS`. The checkpoint manager waits
  this long after it finds no `EXECUTING` operation and at least one waiting operation. Then it
  suspends the invocation.

## Context

1. The checkpoint manager decides when to suspend from lifecycle states alone. It does not see
   any other pending JavaScript work.
2. So any SDK work that runs while no operation is `EXECUTING` is invisible to it.
3. If that work takes longer than the cooldown, and another operation is waiting, the
   invocation suspends before the work finishes.
4. The code after that work then does not run in this invocation.
5. Assume that code submits a callback ID to an external system, and the waiting operation is
   that callback. Then the service starts no later invocation until the callback times out. So
   the workflow fails with a callback timeout.
6. On Lambda the outcome measured worse. The skipped code ran after the invocation returned
   `PENDING`, and the SDK did not record it. The next invocation ran it again. So its side
   effects happened twice.

Two kinds of work caused this:

- Async deserialization. Handlers marked an operation `COMPLETED` before they awaited its
  deserializer. A storage-backed serdes takes tens of milliseconds.
- Plugin hooks. The SDK awaited every hook, and some hooks run while no operation is
  `EXECUTING`. Examples: `onOperationStart` of a step, and `onOperationEnd` of a failed step.

Measured with a pending callback, then the operation under test, then a step that submits the
callback: at a 20 ms cooldown the submitting step did not run from a 30 ms delay. At a 3 ms
cooldown it did not run from a 5 ms delay. This held for step, `waitForCondition`, invoke,
`createCallback`, child contexts, `map`, `parallel`, `waitForCallback`, and for slow plugin
hooks.

## Decision

The rules are numbered the same way in `packages/aws-durable-execution-sdk-js/AGENTS.md`.

Rule 1. An operation stays `EXECUTING` until its result is ready for the caller. This covers
serializing, checkpointing, the synchronous part of plugin hooks, and deserializing, on the
execution and the replay path. `completeAfter` in `utils/checkpoint/complete-after.ts`
implements it for one operation.

Rule 2. A child context is `EXECUTING` from the moment its function returns or throws until it
settles. This holds while a `wrapChildContextFn` hook still runs after the function settled. It
is not `EXECUTING` while its function runs, because the operations inside the function track
themselves and must be able to suspend the invocation.

Rule 3. The SDK never waits for an operation plugin hook. These are `onOperationStart`,
`onOperationEnd`, `onOperationAttemptStart`, `onOperationAttemptEnd` and `onOperationChange`.
The plugin runner calls them, runs their synchronous part, and continues. So a plugin cannot
delay an operation or the suspension. The runner guarantees the order of the calls. For nested
operations that is `parent start → child start → child end → parent end`. It does not guarantee
the order in which the hooks' asynchronous work finishes.

Rule 4. The plugin runner drains hook work in one place. Before it calls `onInvocationEnd`, it
waits for the asynchronous work of earlier hooks to settle. Then it waits for `onInvocationEnd`.
Two deadlines bound the waits. The drain stops `PLUGIN_DRAIN_RESERVE_MS` (500 ms) before the
invocation's deadline. The wait for `onInvocationEnd` stops `PLUGIN_END_RESERVE_MS` (50 ms)
before it. So a plugin that never settles cannot hold the invocation to the Lambda timeout. So
also slow operation-hook work cannot take the time of the flush in `onInvocationEnd`. A context
that reports no usable deadline counts as having none, and the waits then last until
everything settles.

Rule 5. `onInvocationStart` and the `wrap` hooks stay inline. `onInvocationStart` runs before
any operation, so waiting for it delays no operation. The `wrap` hooks run the customer's
function, so they cannot be detached.

## Consequences

- A plugin cannot rely on its asynchronous work finishing before the next operation runs. Work
  that must finish before the Lambda response belongs in `onInvocationEnd`, or is drained there.
- While an operation finishes, the invocation cannot suspend. So a deserializer or serializer
  that never settles keeps the invocation open until the Lambda timeout.
- An `await` in customer code between two operations is still invisible to the checkpoint
  manager. No SDK rule can cover it.
- Each child context adds one entry to the checkpoint manager's operation map. Measured on a
  `map` whose items each run one step, with no plugin and no pending callback, median of 5 runs
  in two rounds: 3000 items took 97 ms before and 102 ms after, and 5000 items took 200 to
  206 ms before and 219 ms after. That is 5 to 10 % slower. A `map` whose items only return a
  value showed no difference beyond run-to-run variation.
- An invocation's last plugin flush may be cut off. The flush in `onInvocationEnd` gets until
  50 ms before the deadline, and earlier hook work until 500 ms before it.
- All plugins share the drain. The runner calls `onInvocationEnd` on every plugin only after
  the pending work of all plugins has settled, or the drain deadline has passed. So when one
  plugin's operation hooks are slow, another plugin's flush gets at most 450 ms, although it
  does not depend on that work. A per-plugin drain would remove this coupling. It is not part
  of this decision.

## Enforcement

- Tests. `src/utils/checkpoint/deserialization-suspension.composed.test.ts` guards Rules 1
  and 2. `src/utils/plugin/plugin-hook-contract.composed.test.ts` guards Rules 3 and 4.
  `src/utils/plugin/plugin-runner.test.ts` guards Rules 3, 4 and 5. In
  `src/context/execution-context/execution-context.test.ts`, the cases named
  "reports the remaining time as Infinity" guard the deadline reading in Rule 4. A failing case
  in these files means the change breaks a rule. Do not edit or delete such a case to make a
  change pass. Change this ADR first.
- Review. `.github/CODEOWNERS` requires a maintainer review for the files that implement these
  rules. The AI PR review reads `packages/aws-durable-execution-sdk-js/AGENTS.md`, which lists
  the rules.
- Changing a rule needs a new ADR that supersedes this one. The ADR states the new rule, the
  measured effect on suspension, and the tests that change.
