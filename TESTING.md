# AWS Durable Execution SDK - Testing

## Table of Contents

- [Overview](#overview)
  - [Test classification](#test-classification)
  - [File naming conventions](#file-naming-conventions)
  - [Examples](#examples)
  - [Integration test structure](#integration-test-structure)
- [Running Tests](#running-tests)
  - [All Tests](#all-tests)
  - [Individual Package Tests](#individual-package-tests)
  - [Running Cloud Integration Tests](#running-cloud-integration-tests)
- [CI/CD Integration](#cicd-integration)
  - [Checking function logs](#checking-function-logs)
- [Creating tests](#creating-tests)

## Overview

The AWS Durable Execution SDK is validated to ensure reliability and correctness in four ways:

| Testing Architecture   | Description                                                                  |
| ---------------------- | ---------------------------------------------------------------------------- |
| 🧪 Unit Tests          | Test individual SDK components in isolation with mocked dependencies         |
| 🔗 Composed Tests      | Test multiple internal components wired together, external boundary mocked   |
| ⚡ Integration (Local) | Full execution path via the testing SDK's `LocalDurableTestRunner`, no mocks |
| ☁️ Integration (Cloud) | Same tests run against the real Lambda Durable Execution service             |

This approach addresses different aspects of validation and development workflows:

1. Unit Tests - Immediate feedback, isolate component issues
2. Composed Tests - Validate interactions between internal classes without external dependencies
3. Integration (Local) - Fast end-to-end validation without any cloud dependencies
4. Integration (Cloud) - Validation against the real Durable Execution service

### Test classification

| Class               | External services                        | Internal dependencies | Example                          |
| ------------------- | ---------------------------------------- | --------------------- | -------------------------------- |
| Unit                | Mocked                                   | Mocked                | `step-handler.test.ts`           |
| Composed            | Faked (e.g. `InMemoryStorage`) or mocked | Real                  | `checkpoint-composed.test.ts`    |
| Integration (Local) | `LocalDurableTestRunner` (in-process)    | Real                  | `step-basic.test.ts` (local run) |
| Integration (Cloud) | Real Lambda service                      | Real                  | `step-basic.test.ts` (cloud run) |

### File naming conventions

| Suffix                  | Class                                                 |
| ----------------------- | ----------------------------------------------------- |
| `*.test.ts`             | Unit test                                             |
| `*.composed.test.ts`    | Composed test                                         |
| `*.integration.test.ts` | Integration test (local or cloud depending on runner) |

Additional suffixes used for specialized unit test variants:

- `*.plugin.test.ts` — tests for the plugin/hook system
- `*.timing.test.ts` — timing-related behavior
- `*.replay.test.ts` — replay-specific behavior
- `*.two-phase.test.ts` — two-phase commit behavior

### Examples

The [examples package](./packages/aws-durable-execution-sdk-js-examples) combines both documentation and integration testing through code examples with their corresponding tests. Each example demonstrates both the SDK and testing SDK's usage patterns, while also providing validation of the SDK and testing SDK in local and cloud environments.

All integration tests are run against both the testing SDK's local runner, and the actual service. This ensures parity between the testing SDK and the service, while also allowing for fast development feedback when working on changes locally.

### Integration test structure

The integration tests use both operation-level and execution-level assertions in both the local and cloud environments. This allows us to explicitly assert on specific results from individual tests to ensure correctness.

In addition to the explicit assertions, the tests also use **event signature validation** with `.history.json` files and the `assertEventSignatures` function. This history is used to compare actual events against the stored signature. It ensures deterministic execution by verifying that event sequences remain consistent across runs, and can also detect regressions by identifying unexpected changes to the execution flow.

## Running Tests

### All Tests

```bash
# Run all tests across all packages
npm test
```

This command executes the following tests:

1. **SDK Unit + Composed Tests** (`packages/aws-durable-execution-sdk-js`)
2. **Testing SDK Unit + Composed + Integration (Local) Tests** (`packages/aws-durable-execution-sdk-js-testing`)
3. **Examples Integration (Local) Tests** (`packages/aws-durable-execution-sdk-js-examples`)
4. **ESLint Plugin Unit + Composed Tests** (`packages/aws-durable-execution-sdk-js-eslint-plugin`)

### Individual Package Tests

```bash
# SDK core unit + composed tests
npm run test -w packages/aws-durable-execution-sdk-js

# Testing SDK unit + composed + integration (local) tests
npm run test -w packages/aws-durable-execution-sdk-js-testing

# Examples integration tests (local)
npm run test -w packages/aws-durable-execution-sdk-js-examples
```

### Running Cloud Integration Tests

It is possible to run the integration tests against the real Lambda service in your personal account following these steps:

0. Ensure your AWS credentials are available
1. [Optional] Configure a `.env` file at the top level with `AWS_ACCOUNT_ID`. You can also specify: `AWS_REGION`, `CAPACITY_PROVIDER_ARN`, `LAMBDA_ENDPOINT`
2. Run the tests:

```bash
# Deploys all functions and runs all tests in your account
npm run test:integration -- --runtime 24.x
# or if .env is not configured
AWS_ACCOUNT_ID=123456789012 npm run test:integration -- --runtime 24.x

# Deploys specific functions and runs test in your account
npm run test:integration -- --test-pattern step-basic --runtime 24.x

# See more options with --help
npm run test:integration -- --help
```

## CI/CD Integration

The automated testing pipeline is defined in [`.github/workflows/build.yml`](./.github/workflows/build.yml). Pull requests and merges to the main branch both run the same `build.yml` on every change. This script does the following:

1. Check PR title and ensure it matches what we expect based on [lintcommit.js](.github/workflows/lintcommit.js).
2. Checks formatting and lint across the monorepo with `biome ci` using [lint.yml](.github/workflows/lint.yml). This runs off the sources, so it does not wait for the build.
3. Builds the entire package and uploads the build artifact for other steps to use
4. Runs unit tests using the build artifacts on node 22 and node 24 using [unit-tests.yml](.github/workflows/unit-tests.yml)
5. Runs integration tests using the build artifacts on node 22 and node 24 using [integration-tests.yml](.github/workflows/integration-tests.yml)

The integration tests are orchestrated by the [integration test workflow](.github/workflows/integration-tests.yml). The workflow requires the following secrets:

- `TEST_ROLE_ARN` - Used for assuming the role to our AWS account used for testing functions
- `LAMBDA_ENDPOINT` - Used to set a custom Lambda endpoint
- `TEST_ACCOUNT_ID` - The AWS account ID that we use for testing functions
- `TEST_LAMBDA_EXECUTION_ROLE_ARN` - The Lambda execution role ARN used by deployed test functions
- `TEST_CAPACITY_PROVIDER_ARN` - The capacity provider ARN we use for testing functions that use Lambda Managed Instances

And one variable: `AWS_REGION` - The AWS region used for testing functions.

Integration test function deployment and tests are orchestrated using the [integration test script](./.github/workflows/scripts/integration-test/integration-test.js).

The SAM-managed integration test functions are deployed once per runtime and reused across PRs.

### Checking function logs

The functions used in the integration tests are kept alive for reuse. This makes it possible to debug functions or function logs in the console.

**Function Naming Convention:**

- SAM-managed integration functions: `{ExampleName}-24x-NodeJS`
- Capacity-provider PR functions: `{ExampleName}-24x-NodeJS-PR-{number}-CapacityProvider`
- Local Development: `{ExampleName}-24x-NodeJS-Local`
- Functions deployed to personal account: `${ExampleName}-24x-NodeJS-Local-CapacityProvider`

## Creating tests

For implementation details on creating new tests and their corresponding history files, see [ADDING_EXAMPLES.md](./packages/aws-durable-execution-sdk-js-examples/ADDING_EXAMPLES.md).

## Conformance Tests

Conformance tests verify cross-SDK behavioral parity and live in a separate repository: [aws-durable-execution-conformance-tests](https://github.com/aws/aws-durable-execution-conformance-tests). Contributors do not need to add conformance tests. If you believe a change warrants one, mention it in your PR description or [open an issue](https://github.com/aws/aws-durable-execution-conformance-tests/issues/new?template=new_requirement.yml) in that repository.
