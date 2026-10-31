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
