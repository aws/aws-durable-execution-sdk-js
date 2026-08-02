# Finishing the CDK plugin — codegen for every node kind + the construct

`@aws/durable-execution-sdk-js-cdk` turns a Workflow Studio `.dar` file into a
deployable durable Lambda. Today `generateHandler` only emits **step** nodes
(with the result-const data flow) and throws for every other kind. This plan
completes it.

## Design decisions (locked)

- **Result-const data flow** stays: each operation node binds
  `const <ident> = await context.<op>(...)`; later nodes reference earlier
  results by that identifier. `buildIdentifierMap` is rebuilt per workflow scope
  (nested container/branch bodies are their own scopes).
- **Recursive emitter**: `generateHandler` is refactored around an
  `emitChain(wf, fromNodeId, ctxVar, indent)` walker so container bodies
  (`map`/`group`/`parallel` branches) and `condition` branches recurse with a
  different context variable (`context` → `childCtx`/`ctx`) and indent.
- **Linear by default**: the walker follows each node's single outgoing edge.
  `condition` is the only fan-out; its branches are independent linear tails
  (branch reconvergence / true DAG is out of scope for now and is validated
  against in the Studio).
- **Determinism**: strategies and switch values are emitted deterministically;
  same `.dar` ⇒ byte-identical handler.
- **SDK API mapping** (confirmed from the SDK source):
  - step → `context.step(name, async (stepCtx) => {…}, { retryStrategy })`
  - wait → `context.wait(name, { <unit>: value })`
  - callback → `context.waitForCallback(name, async (callbackId, ctx) => {…}, { timeout })`
  - chainInvoke → `context.invoke(name, funcId, <payload>)`
  - waitForCondition → `context.waitForCondition(name, async (state, ctx) => {…}, { initialState, waitStrategy })`
  - group → `context.runInChildContext(name, async (childCtx) => {…})`
  - map → `context.map(name, <items>, async (ctx, item, index) => {…}, { maxConcurrency, completionConfig, nesting })`
  - parallel → `context.parallel(name, [{ name, func: async (ctx) => {…} }], { maxConcurrency, completionConfig })`
  - strategies → `createRetryStrategy` / `createLinearRetryStrategy` / `createWaitStrategy`, jitter via `JitterStrategy`.

## Subtasks (one reviewed commit each)

- [x] **1. Retry/wait strategy emission.** `emitStrategy(spec)` →
      `createRetryStrategy({ maxAttempts, initialDelay:{seconds}, maxDelay:{seconds}, backoffRate, jitter: JitterStrategy.FULL })`,
      `createLinearRetryStrategy({ …, increment:{seconds} })`, or omit for `"none"`
      (emit `maxAttempts: 1` retry). Wire step `retry` → `{ retryStrategy }`.
      Import the builders + `JitterStrategy` in the generated handler only when used.
- [x] **2. Leaf kinds.** Emit `wait`, `callback` (submitter body + timeout),
      `chainInvoke` (`invoke` with parsed payload), `waitForCondition` (check body +
      `initialState` + `waitStrategy` from its `wait` spec, `shouldContinuePolling`
      convention: continue until the returned state is `{ done: true }`).
- [x] **3. Recursive emitter refactor + containers.** Extract `emitChain`;
      emit `group` (`runInChildContext`), `map` (`context.map`, items as a
      deterministic IIFE, `item`/`index` in scope, completion + nesting config),
      `parallel` (named branches). Bodies recurse with their own scope + ctx var.
- [x] **4. Condition (switch).** Wrap the branch expression in a step, then
      `switch` over it: one `case` per labelled outgoing edge (emit that branch's
      linear tail), unlabelled edge → `default`. Terminal branches just `break`.
- [x] **5. executionTimeout inference.** `inferExecutionTimeoutSeconds(wf)` =
      sum of waits + callback/waitForCondition worst-case waits along the workflow
      (recursing containers), buffered, floored at a minimum, capped at 1 year.
- [x] **6. `DurableWorkflowFunction` construct.** (needs `aws-cdk-lib` +
      `constructs` as peer/dev deps) Wraps `NodejsFunction`: writes the generated
      handler to a generated entry, bundles the SDK, sets `durableConfig`
      (`executionTimeout` from #5, `retentionPeriod`), publishes a version + alias.
- [x] **7. README + runnable example.** Deploy a `.dar` in ~10 lines of CDK;
      document the generated shape, conventions, and current limitations.

## Known limitations (documented, not blocking)

- `waitForCondition` stop-condition uses the `{ done: true }` convention (the
  Studio model has no explicit stop predicate yet).
- `condition` branches must be independent linear tails (no reconvergence).
- `map` `itemsCode` must be deterministic (it runs outside a step).
