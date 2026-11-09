# AGENTS.md

Rules for coding agents that change this repository. People follow them too.

## Before you start

1. Read the [rules for every change](./CONTRIBUTING.md#rules-for-every-change). Reviewers,
   people and agents, enforce them.
2. Before you change the SDK package, read
   [packages/aws-durable-execution-sdk-js/AGENTS.md](./packages/aws-durable-execution-sdk-js/AGENTS.md).
   It lists the SDK invariants and the contract tests that guard them.
3. A new feature, a new option or a public API change starts with a design note. A maintainer
   agrees to it before you write code.

## How to work

1. Keep the change as small as the problem. Prefer removing or merging logic to adding it.
2. Do not add options, fallbacks or defensive code that nobody asked for.
3. Fix a bug at its cause, not where it shows up. Write a test that fails first.
4. Every new branch needs a test that fails without it.
5. Never edit, skip or delete a contract test to make a change pass.
6. Mark every assumption about Lambda, the service or a library that you did not check
   against the real thing as "unverified" in the pull request.
7. List the decisions the task did not cover in the pull request, one line each.
8. If a review round finds new blocking issues after you fixed the last round, stop. Report
   all findings and your view of the cause, and wait for a decision.

## Commands

Run all commands from the repository root.

```bash
npm run install-all                  # install the root and every workspace
npm run build                        # build the packages that others depend on
npm run test -w packages/<package>   # test one package
npm test                             # test every package
npm run lint:fix                     # format and lint with Biome
```

Do not run `npm run test:integration` unless asked. It deploys functions to a real AWS account.

## Tests

1. The minimum is unit tests. [TESTING.md](./TESTING.md) says when composed and integration
   tests are needed.
2. The file suffix sets the test class: `*.test.ts`, `*.composed.test.ts`,
   `*.integration.test.ts`.
3. A new SDK feature or API change adds an example in
   `packages/aws-durable-execution-sdk-js-examples`. Examples are also integration tests. See
   [ADDING_EXAMPLES.md](./packages/aws-durable-execution-sdk-js-examples/ADDING_EXAMPLES.md).
4. Do not add conformance tests. They live in
   [aws-durable-execution-conformance-tests](https://github.com/aws/aws-durable-execution-conformance-tests).

## Replay rules for examples and tests

A durable function runs again from the top on every replay. A finished step returns its
saved result and does not run again. So in any durable function you write here:

1. Code outside a step must be deterministic. Put `Date.now()`, `Math.random()`, UUIDs and
   API calls inside `context.step`.
2. Do not call durable operations inside a step. Use `context.runInChildContext` to group them.
3. Return values from steps. A variable changed inside a step is lost on replay.
4. Side effects outside a step repeat on every replay. Use `context.logger`, which is replay
   aware, instead of `console.log`.
5. Name every operation. Tests find operations by name, not by index.

More detail: [CONCEPTS.md](./packages/aws-durable-execution-sdk-js/src/documents/CONCEPTS.md).

## Pull requests

1. The title is a conventional commit, such as `fix(sdk): ...`. The allowed types and scopes
   are in [.github/workflows/lintcommit.js](./.github/workflows/lintcommit.js).
2. Never use `--no-verify`. CI runs the same checks.

## Reviewing a pull request

These rules apply to every reviewer, a person or an agent. The CI review bot follows them
through [.github/prompts/ai-pr-review.md](./.github/prompts/ai-pr-review.md).

### What to check

1. The SDK invariants in
   [packages/aws-durable-execution-sdk-js/AGENTS.md](./packages/aws-durable-execution-sdk-js/AGENTS.md).
2. The contract tests named there. A change may edit, skip or delete a contract test case
   only with a new ADR under [docs/adr](./docs/adr) that replaces the rule.
3. The [rules for every change](./CONTRIBUTING.md#rules-for-every-change), rules 1 to 11.
   A change can be correct and still break one.
4. The PR description: the design note (rule 3), the root cause of a bug (rule 5),
   unverified assumptions (rule 6) and decisions the task did not cover (rule 7).
5. Correctness: regressions, edge cases, typing and error handling.
6. Replay: determinism, checkpoint matching and the semantics of steps, waits, callbacks,
   child contexts, invokes, maps and parallel branches.
7. Suspension: SDK work awaited while no operation is `EXECUTING`, and plugin hooks awaited
   on the operation path.
8. Serialization, error propagation, retry, timeout and cancellation.
9. Public API compatibility across ESM, CommonJS and the supported Node.js versions.
10. Missing or weak unit, composed and integration tests. A change that needs a conformance
    test says so in its description. It does not add one.

### Severity

1. Highest: a broken SDK invariant, even if the tests pass, and a contract test edited,
   skipped or deleted without a new ADR.
2. Below that: code findings (bugs, missing tests) and approach findings (a broken rule
   from `CONTRIBUTING.md`), ordered by impact.

### How to write a finding

1. Report only confirmed, actionable findings, in severity order.
2. A code finding names the file and changed line, the impact and a concrete fix.
3. An approach finding names the rule and how the change breaks it, on the added line that
   shows it best. For example, the first line of a new API that has no design note. Do not
   ask for detailed code changes. Ask the contributor to return to the design phase
   (rule 8), with a simpler direction if you see one.
4. If there are no findings, say so and name any test risk that remains.
