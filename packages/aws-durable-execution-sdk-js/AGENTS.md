# SDK internals: rules for changing this package

This file is for people and coding agents who change the SDK itself. The repository root
`AGENTS.md` is for customers who write durable functions.

## Invariants

The checkpoint manager suspends the invocation when no operation is `EXECUTING` and another
operation is waiting. It sees only lifecycle states. So SDK work that runs while no operation is
`EXECUTING` can be cut off, and the code after it then runs in no recorded invocation. The rules
below prevent that. [ADR 0001](../../docs/adr/0001-operation-tracking-and-plugin-hooks.md)
gives the reasons and the measurements.

1. An operation stays `EXECUTING` until its result is ready for the caller. This includes
   serializing, checkpointing, the synchronous part of plugin hooks, and deserializing, on the
   execution and the replay path. Use `completeAfter` (`src/utils/checkpoint/complete-after.ts`).
   Never mark an operation `COMPLETED` and then await more work for it.
2. A child context is `EXECUTING` from the moment its function returns or throws until it
   settles, also while a `wrapChildContextFn` hook still runs after the function settled. It is
   not `EXECUTING` while its function runs.
3. The SDK never waits for an operation plugin hook: `onOperationStart`, `onOperationEnd`,
   `onOperationAttemptStart`, `onOperationAttemptEnd`, `onOperationChange`. The plugin runner
   (`src/utils/plugin/plugin-runner.ts`) calls them without waiting. Do not make it wait.
4. Hook work is drained only before `onInvocationEnd`. The drain stops 500 ms before the
   invocation's deadline (`PLUGIN_DRAIN_RESERVE_MS`). The wait for `onInvocationEnd` stops 50 ms
   before it (`PLUGIN_END_RESERVE_MS`). Do not remove either deadline. Do not let reading the
   deadline fail the invocation: a missing, throwing or non-finite reading means no deadline.
5. `onInvocationStart` and the `wrap` hooks stay inline.

## Tests that guard the invariants

- `src/utils/checkpoint/deserialization-suspension.composed.test.ts`: rules 1 and 2.
- `src/utils/plugin/plugin-hook-contract.composed.test.ts`: rules 3 and 4.
- `src/utils/plugin/plugin-runner.test.ts`: rules 3, 4 and 5.
- `src/context/execution-context/execution-context.test.ts`: the cases named "reports the
  remaining time as Infinity" guard the deadline reading in rule 4. The rest of that file is
  ordinary unit tests.

If a change makes one of these cases fail, the change breaks an invariant. Do not edit, skip or
delete the case to make the change pass. To change an invariant, write a new ADR that supersedes
ADR 0001 first, and get a maintainer's approval for it.
