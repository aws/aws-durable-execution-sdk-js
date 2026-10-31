# Working in this repository

This file is for coding agents and people who change this repository. To write durable
functions with this SDK, read [docs/CUSTOMER_AGENT_GUIDE.md](./docs/CUSTOMER_AGENT_GUIDE.md)
instead.

## Read first

1. [CONTRIBUTING.md](./CONTRIBUTING.md#rules-for-every-change): the rules for every change.
   They apply to every package. Reviewers, people and agents, enforce them.
2. [packages/aws-durable-execution-sdk-js/AGENTS.md](./packages/aws-durable-execution-sdk-js/AGENTS.md)
   before you change the SDK package. It lists the SDK invariants and the contract tests that
   guard them.
3. [TESTING.md](./TESTING.md) for the test classes and how to run them.

## Commands

Run all commands from the repository root.

```bash
npm run install-all                  # install the root and every workspace
npm run build                        # build the packages that others depend on
npm test                             # run the tests of every package
npm run test -w packages/<package>   # run the tests of one package
npm run lint                         # check format and lint, no writes
npm run lint:fix                     # format and lint, applying safe fixes
npm run typecheck:hosts              # typecheck the telemetry host packages
```

`npm run test:integration` deploys functions to a real AWS account. Do not run it unless
you are asked to. See [TESTING.md](./TESTING.md#running-cloud-integration-tests).

## Packages

All packages are in `packages/`. The prefix `aws-durable-execution-sdk-js-` is left out below.

| Folder                                       | What it holds                                                    |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `aws-durable-execution-sdk-js`               | The SDK, `@aws/durable-execution-sdk-js`                          |
| `-testing`                                   | The testing SDK, `LocalDurableTestRunner`                         |
| `-examples`                                  | Examples. They are also the integration tests                     |
| `-eslint-plugin`                             | ESLint rules for durable function code                            |
| `-extras`                                    | Custom durable operations, such as a Lambda MicroVM job           |
| `-microvm-worker`                            | Runs inside a Lambda MicroVM and reports the job result           |
| `-otel`                                      | OpenTelemetry plugin                                              |
| `-telemetry-exporter`                        | Durable Execution Telemetry plugin                                |
| `-telemetry-core`                            | Shared query logic for the telemetry hosts                        |
| `-telemetry-mcp`, `-vscode`, `-desktop`      | Telemetry hosts: MCP server, VS Code extension, desktop app       |
| `-conformance-tests`, `-otel`, `-telemetry`  | Handlers that the external conformance runner calls               |
| `cjs-`, `esm-`, `cdk-bundling-`, `lambda-runtime-detection-integration-test` | Module format and bundling checks |
| `otel-compatibility-fixtures`                | Pinned OTel packages for backward compatibility tests             |

## Tests

1. Every change has tests. The minimum is unit tests. [CONTRIBUTING.md](./CONTRIBUTING.md)
   says when composed and integration tests are needed too.
2. The file suffix sets the test class: `*.test.ts` is a unit test, `*.composed.test.ts` is a
   composed test, `*.integration.test.ts` is an integration test.
3. A new SDK feature or API change adds or updates an example in the examples package. See
   [ADDING_EXAMPLES.md](./packages/aws-durable-execution-sdk-js-examples/ADDING_EXAMPLES.md).
4. Do not add conformance tests. They live in
   [aws-durable-execution-conformance-tests](https://github.com/aws/aws-durable-execution-conformance-tests).
   If a change needs one, say so in the pull request description.

## Formatting

Biome formats and lints JavaScript, TypeScript and JSON. The pre-commit hook runs it on
staged files. Markdown and YAML are not formatted.

## Pull requests

1. The title is a conventional commit, for example `fix(sdk): ...`. The allowed types and
   scopes are in [.github/workflows/lintcommit.js](./.github/workflows/lintcommit.js).
2. The description follows rules 3 to 7 in [CONTRIBUTING.md](./CONTRIBUTING.md): the design
   note, the failing test for a bug fix, unverified assumptions and decisions that the task
   did not cover.
3. Never use `--no-verify`. CI runs the same checks.
