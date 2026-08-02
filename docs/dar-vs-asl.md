# `.dar` vs Amazon States Language (ASL)

A comparison of the Workflow Studio `.dar` format (specified in
[dar-specification.md](./dar-specification.md)) with the [Amazon States
Language](https://states-language.net/) used by AWS Step Functions. The two
models are close cousins — close enough that Studio ships a deterministic
ASL importer (`aslSkeleton.ts` maps states to nodes 1:1; an AI pass then fills
the code bodies) — but they differ fundamentally in execution model and data
flow.

## Fundamental difference: interpreted DSL vs compiled model

**ASL** is a declarative JSON program interpreted at runtime by a managed
service. The definition _is_ the execution artifact; all logic must be
expressible in the DSL (path algebra, Choice rule operators,
intrinsics/JSONata) or pushed out to Task resources.

**`.dar`** is a serialized authoring model that gets _compiled away_: the CDK
code generator emits an imperative TypeScript durable Lambda handler, and the
runtime semantics (checkpointing, replay, retries, suspension) come from the
durable-execution SDK — not a graph interpreter. Nodes carry real TypeScript
(`code`, `submitterCode`, `itemsCode`), so the graph is scaffolding for
codegen rather than the program itself.

## Construct mapping

As implemented by the Studio's Step Functions importer:

| ASL                                                                          | `.dar`                               | Notes                                                                                              |
| ---------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `Task` (generic)                                                             | `step`                               | body becomes a TS code block                                                                       |
| `Task` `lambda:invoke` (durable target)                                      | `chainInvoke`                        | `context.invoke`                                                                                   |
| `Task` `.waitForTaskToken`                                                   | `callback`                           | task token ↔ `callbackId`                                                                          |
| `Task` `.sync` (run-a-job)                                                   | `awsJob`                             | expands to step + waitForCondition — the same pattern ASL hides in the service                     |
| SDK service integrations                                                     | `awsSdkCall`                         | step wrapping `client.send(command)`                                                               |
| `Wait`                                                                       | `wait`                               | dynamic `SecondsPath`/`TimestampPath` has no equivalent (importer flags it)                        |
| `Choice`                                                                     | `condition`                          | rules → edges with `match`; `Default` → the matchless edge                                         |
| `Map`                                                                        | `map`                                | `ItemsPath` → `itemsCode`; `MaxConcurrency`, `ToleratedFailure*` map 1:1; `ItemProcessor` → `body` |
| `Parallel`                                                                   | `parallel`                           | `Branches` → `branches[].body`                                                                     |
| `Pass`                                                                       | `inline`                             | pure transform, no external work — and no checkpoint on our side                                   |
| `Succeed` / `Fail`                                                           | `end`                                | `endMode: "return"` / `"throw"`                                                                    |
| `StartAt` / `Next` / `End`                                                   | `start` node, edges, `terminal` flag |                                                                                                    |
| `Retry`                                                                      | `RetryStrategySpec`                  | near 1:1 (`BackoffRate`, `MaxAttempts`, `MaxDelaySeconds`, `JitterStrategy`); `.dar` adds `linear` |
| `Catch`                                                                      | `"error"`-kind edges                 | `ErrorEquals` ≈ `errorType` on the edge; routing lives on edges, never on nodes                    |
| `InputPath`/`Parameters`/`ResultSelector`/`ResultPath`/`OutputPath`, JSONata | — (not needed)                       | replaced by result constants + plain TypeScript, see below                                         |

## Biggest semantic gap: data flow

ASL threads a single JSON document through each state, manipulated by path
algebra (`InputPath`/`Parameters`/`ResultSelector`/`ResultPath`/`OutputPath`)
or — since the JSONata update — expressions plus `Assign` variables.

`.dar` binds every operation's result to a **named TypeScript const**, and any
downstream node's code references upstream results lexically (with `event`/
`input` at the root, `item`/`index` in map bodies). ASL's 2024 variables
feature is essentially a retrofit of what `.dar` has natively — and since
`.dar` "expressions" are full TypeScript, no intrinsic-function library or
path syntax is needed at all.

The tradeoff: ASL's declarative rules are statically analyzable and
console-renderable; `.dar`'s TS expressions are strictly more expressive but
opaque to tooling (which is exactly why the Choice → condition import needs an
AI pass to translate rule algebra into an expression).

## What ASL has that `.dar` doesn't

- Per-task `TimeoutSeconds` / `HeartbeatSeconds` (`.dar` has a timeout only on
  `callback`).
- **Distributed Map** — `ItemReader` over S3, 10k-scale fan-out;`.dar`'s `map`
  is in-process `context.map` with modest concurrency.
- The declarative Choice rule algebra (verbose, but machine-checkable).
- Service-level execution modes (Express vs Standard) and state-machine-level
  versions/aliases (`.dar` deployments inherit Lambda's versions/aliases
  instead).

## What `.dar` has that ASL doesn't

- **Checkpoint economics as a modeled dimension** — the most consequential
  difference. ASL bills every state transition uniformly; `.dar` distinguishes
  checkpointed nodes (`step` et al.) from free ones (`inline`, `condition`),
  and `map` NESTED vs FLAT. ASL's `Pass` always costs a transition; `.dar`'s
  `inline` costs nothing.
- Real code in nodes — a step body is TypeScript in-process, not a service
  round-trip per state.
- `group` (`runInChildContext`) — named scoping; ASL has nothing short of a
  one-branch Parallel.
- `waitForCondition` — first-class polling with a wait strategy; ASL needs a
  Wait + Choice loop (or `.sync` where supported).
- `fallbackCode` on error branches — an inline recovery value; ASL must
  Catch-route to a Pass state.
- Static typing (`inputType`, `resultType`) checked by `tsc` against generated
  code; ASL is untyped JSON.
- Canvas layout persisted in the file (`position`, `layoutDirection`) —
  Workflow Studio for Step Functions keeps layout outside the definition.

## Structural similarities

Both are versioned JSON graphs with:

- a designated start (`StartAt` ≈ the `start` node) and terminal states
  (`Succeed`/`Fail`/`"End": true` ≈ `end` nodes / `terminal` flag);
- guarded transitions out of branch states (Choice rules ≈ condition edges
  with `match`; `Default` ≈ the matchless edge);
- nested sub-definitions for Map/Parallel (`ItemProcessor`/`Iterator` ≈
  `body`; `Branches` ≈ `branches`);
- per-state open field sets (`.dar`'s `additionalProperties: true` per node
  mirrors ASL's per-`Type` fields);
- a version field (`darVersion` ≈ ASL's `Version`), though `.dar` also has an
  actual migration mechanism (`migrateDar`).

## Import fidelity notes

The importer degrades exactly at the semantic gaps: dynamic `Wait`
(`SecondsPath`/`TimestampPath`) is defaulted and flagged, Choice rule algebra
is translated into a TypeScript expression by the AI pass, and path algebra
(`ResultPath` and friends) dissolves into ordinary code over result constants.
Everything else maps deterministically in Pass 1.

## Import is one-way, by design

There is no `.dar` → ASL exporter, and none is planned. This is intentional,
not an oversight:

- ASL states are declarative and interpreted; once a `.dar` node's body is
  real TypeScript (arbitrary steps, closures, helper calls, control flow),
  there's no general way to decompile it back into ASL's declarative
  `Resource`/`Parameters`/`ResultSelector`/path-algebra model. A faithful
  exporter would have to either reject most real workflows or emit opaque
  passthrough states that just call back into Lambda — at which point it
  isn't really "Step Functions" anymore.
- `.dar` is explicitly a **compiled-away build artifact** (see
  ["Fundamental difference"](#fundamental-difference-interpreted-dsl-vs-compiled-model)
  above) — it exists to _generate_ a durable Lambda handler, not to be
  interpreted at runtime the way a state machine is. Converting it back into
  an interpreted format runs against that design.
- ASL import exists to make **migrating onto durable functions** from an
  existing state machine cheaper, not to make the Studio a general-purpose
  Step Functions editor. Round-tripping isn't a goal.

If you need to go the other direction, treat the generated Lambda handler as
the source of truth and hand-author (or generate) a state machine around it
instead of trying to derive one from the `.dar`.
