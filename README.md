# AWS Durable Execution SDKs for JavaScript

[![Build](https://github.com/aws/aws-durable-execution-sdk-js/actions/workflows/build.yml/badge.svg)](https://github.com/aws/aws-durable-execution-sdk-js/actions/workflows/build.yml)
[![Core Conformance](https://github.com/aws/aws-durable-execution-sdk-js/actions/workflows/conformance-tests.yml/badge.svg)](https://github.com/aws/aws-durable-execution-sdk-js/actions/workflows/conformance-tests.yml)
[![OpenTelemetry Conformance](https://github.com/aws/aws-durable-execution-sdk-js/actions/workflows/otel-conformance-tests.yml/badge.svg)](https://github.com/aws/aws-durable-execution-sdk-js/actions/workflows/otel-conformance-tests.yml)
[![NPM Version](https://img.shields.io/npm/v/@aws/durable-execution-sdk-js)](https://www.npmjs.com/package/@aws/durable-execution-sdk-js)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/aws/aws-durable-execution-sdk-js/badge)](https://scorecard.dev/viewer/?uri=github.com/aws/aws-durable-execution-sdk-js)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)

---

Build **resilient, long-running AWS Lambda functions** with automatic state persistence, retry logic, and workflow orchestration. Lambda durable functions can run for up to one year while maintaining reliable progress through checkpoints and automatic failure recovery.

## ✨ Key Features

- **Durable Execution** – Automatically persists state and resumes from checkpoints after failures
- **Automatic Retries** – Configurable retry strategies with exponential backoff and jitter
- **Workflow Orchestration** – Compose complex workflows with steps, child contexts, and parallel execution
- **External Integration** – Wait for callbacks from external systems (human-in-the-loop, webhooks)
- **Batch Operations** – Process arrays with concurrency control and completion policies
- **Cost Efficient** – Pay only for active compute time; waits suspend without charges
- **Type Safety** – Full TypeScript support with comprehensive type definitions
- **Local Testing** – Run durable functions in unit tests with time skipping, no AWS deployment needed
- **Observability** – OpenTelemetry traces and Workflow Insight records for every execution
- **Replay Safety Checks** – ESLint rules that flag non-deterministic code outside steps and other mistakes that break replay

## 📦 Packages

This monorepo contains the following packages. Most developers need only the first two.

### Build and test durable functions

| Package                                                                                              | Description                                                                         | npm                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [@aws/durable-execution-sdk-js](./packages/aws-durable-execution-sdk-js)                             | Core SDK for building durable Lambda functions                                      | [![npm](https://img.shields.io/npm/v/@aws/durable-execution-sdk-js)](https://www.npmjs.com/package/@aws/durable-execution-sdk-js)                             |
| [@aws/durable-execution-sdk-js-testing](./packages/aws-durable-execution-sdk-js-testing)             | Local and cloud test runners, plus the `run-durable` CLI                            | [![npm](https://img.shields.io/npm/v/@aws/durable-execution-sdk-js-testing)](https://www.npmjs.com/package/@aws/durable-execution-sdk-js-testing)             |
| [@aws/durable-execution-sdk-js-eslint-plugin](./packages/aws-durable-execution-sdk-js-eslint-plugin) | ESLint rules that catch non-deterministic code and other mistakes that break replay | [![npm](https://img.shields.io/npm/v/@aws/durable-execution-sdk-js-eslint-plugin)](https://www.npmjs.com/package/@aws/durable-execution-sdk-js-eslint-plugin) |

### Observability

| Package                                                                                          | Description                                                                                                  | npm                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [@aws/durable-execution-sdk-js-otel](./packages/aws-durable-execution-sdk-js-otel)               | OpenTelemetry plugin that emits spans for the workflow, each invocation, and each durable operation          | [![npm](https://img.shields.io/npm/v/@aws/durable-execution-sdk-js-otel)](https://www.npmjs.com/package/@aws/durable-execution-sdk-js-otel)               |
| [@aws/durable-execution-sdk-js-insight](./packages/aws-durable-execution-sdk-js-insight)         | Workflow Insight plugin that exports a record of each execution to CloudWatch Logs, S3, DynamoDB, and others | [![npm](https://img.shields.io/npm/v/@aws/durable-execution-sdk-js-insight)](https://www.npmjs.com/package/@aws/durable-execution-sdk-js-insight)         |
| [@aws/durable-execution-sdk-js-insight-mcp](./packages/aws-durable-execution-sdk-js-insight-mcp) | MCP server that lets an AI assistant query Workflow Insight data, read-only                                  | [![npm](https://img.shields.io/npm/v/@aws/durable-execution-sdk-js-insight-mcp)](https://www.npmjs.com/package/@aws/durable-execution-sdk-js-insight-mcp) |

Workflow Insight is in preview (`0.1.0-alpha`). Its explorer apps are not published to npm:

- [Workflow Insight Explorer for VS Code](./packages/aws-durable-execution-sdk-js-insight-vscode) –
  query Insight data in plain English from inside VS Code. Download the `.vsix` from the
  [Releases](https://github.com/aws/aws-durable-execution-sdk-js/releases) page.
- [Workflow Insight Explorer, desktop app](./packages/aws-durable-execution-sdk-js-insight-desktop) –
  the same explorer as a standalone app. Run it from a checkout of this repository.

Both apps use [insight-core](./packages/aws-durable-execution-sdk-js-insight-core), an internal
package that holds the query engines and the safety checks. The MCP server uses it too.

### Experimental

These packages are in alpha. Their APIs may change without a major version bump.

| Package                                                                                                | Description                                                                                  |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| [@aws/durable-execution-sdk-js-extras](./packages/aws-durable-execution-sdk-js-extras)                 | Ready-made custom operations. `microvm` runs a job in an AWS Lambda MicroVM                  |
| [@aws/durable-execution-sdk-js-microvm-worker](./packages/aws-durable-execution-sdk-js-microvm-worker) | Runs inside the MicroVM: receives jobs from `microvm`, sends heartbeats, and reports results |

### Internal packages

These packages support development and are not for installation:

- [examples](./packages/aws-durable-execution-sdk-js-examples) – working example functions, also used as integration tests against deployed Lambda functions
- [conformance-tests](./packages/aws-durable-execution-sdk-js-conformance-tests) and [conformance-tests-otel](./packages/aws-durable-execution-sdk-js-conformance-tests-otel) – handlers that the shared cross-SDK conformance suites run
- [cjs-integration-test](./packages/cjs-integration-test), [esm-integration-test](./packages/esm-integration-test), [cdk-bundling-integration-test](./packages/cdk-bundling-integration-test), and [lambda-runtime-detection-integration-test](./packages/lambda-runtime-detection-integration-test) – check that the SDK works in CommonJS, ESM, a CDK-bundled function, and the Lambda runtime
- [otel-compatibility-fixtures](./packages/otel-compatibility-fixtures) – pinned published packages for OpenTelemetry backward-compatibility tests

## 🚀 Quick Start

### Installation

```bash
npm install @aws/durable-execution-sdk-js
```

### Your First Durable Function

```typescript
import {
  withDurableExecution,
  DurableContext,
} from "@aws/durable-execution-sdk-js";

const handler = async (event: any, context: DurableContext) => {
  // Use the context logger for structured logging
  context.logger.info("Starting workflow", { userId: event.userId });

  // Execute a durable step with automatic retry
  const userData = await context.step("fetch-user", async (stepCtx) => {
    // Step-scoped logger includes step metadata
    stepCtx.logger.debug("Fetching user from database");
    return fetchUserFromDB(event.userId);
  });

  // Wait for 5 seconds (no compute charges during wait)
  await context.wait({ seconds: 5 });

  // Process data in another step
  const result = await context.step("process-user", async (stepCtx) => {
    return processUser(userData);
  });

  context.logger.info("Workflow completed", { result });
  return result;
};

export const lambdaHandler = withDurableExecution(handler);
```

### How It Runs: Replay

A durable function does not keep running while it waits. It can stop to wait for a timer or an event, or because of a failure. Lambda invokes it again when the execution can continue. Each invocation runs your handler from the beginning, and the SDK **replays** the execution up to the point where the previous run stopped:

- At a step that already finished, the SDK returns the step's saved result. It does not run the step's function again.
- At the first operation that has not finished, the SDK runs it and saves its result.

So the code inside a step runs when the step executes, and **the code outside the steps runs again on every replay**. The code outside a step must therefore be deterministic: given the same saved results, it must make the same durable calls in the same order. Anything that can give a different answer the second time goes inside a step. That includes the current time, random numbers, UUIDs, and API calls whose results change.

```typescript
// ❌ Outside a step: runs again on every replay, and returns a new value each time
const orderId = crypto.randomUUID();
```

```typescript
// ✅ Inside a step: the SDK saves the value, so every replay gets the same one
const orderId = await context.step("create-order-id", async () =>
  crypto.randomUUID(),
);
```

The [Concepts & Use Cases](./packages/aws-durable-execution-sdk-js/src/documents/CONCEPTS.md) guide covers the replay model in more detail. The [ESLint plugin](#-catching-replay-bugs-with-eslint) reports code that breaks it.

### Invoking Your Durable Function

Durable functions require a **qualified identifier** for invocation. You must specify a version or alias. Unqualified ARNs or function names without a suffix are not supported to ensure deterministic replay behavior.

The following example uses asynchronous invocation (`--invocation-type Event`), which queues the event and returns immediately, enabling executions that can run for up to one year:

```bash
aws lambda invoke \
  --function-name my-durable-function:$LATEST \
  --invocation-type Event \
  --cli-binary-format raw-in-base64-out \
  --payload '{"userId": "12345"}' \
  response.json
```

> [!TIP]
> To ensure idempotent execution, use the `--durable-execution-name` parameter. See [Idempotency](https://docs.aws.amazon.com/lambda/latest/dg/durable-execution-idempotency.html) in the Lambda developer guide for additional information.

> [!IMPORTANT]
> For production deployments, use numbered versions or aliases instead of `$LATEST` for deterministic replay behavior. See [Invoking durable Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-invoking.html) for more details.

## 📚 Documentation

- **[AWS Documentation](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html)** – Official AWS Lambda durable functions guide
- **[SDK README](./packages/aws-durable-execution-sdk-js/README.md)** – Detailed SDK usage guide with code examples
- **[API Reference](https://docs.aws.amazon.com/durable-execution/)** – Complete technical reference with type definitions
- **[Concepts & Use Cases](./packages/aws-durable-execution-sdk-js/src/documents/CONCEPTS.md)** – Replay model, best practices, and real-world patterns
- **[Examples](./packages/aws-durable-execution-sdk-js-examples)** – Working examples including hello-world, callbacks, parallel processing, and more
- **[OpenTelemetry plugin](./packages/aws-durable-execution-sdk-js-otel/README.md)** – Emit traces from your durable functions
- **[Workflow Insight](./packages/aws-durable-execution-sdk-js-insight/README.md)** – Export execution records and query them

## 🧪 Testing

The testing SDK enables local development and unit testing without deploying to AWS, as well as cloud testing against deployed Lambda functions:

```bash
npm install @aws/durable-execution-sdk-js-testing --save-dev
```

This test is for the handler in the Quick Start above, with your own `fetchUserFromDB` and `processUser`:

```typescript
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { lambdaHandler } from "./handler";

// skipTime fast-forwards through waits
beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

it("fetches and processes the user", async () => {
  const runner = new LocalDurableTestRunner({
    handlerFunction: lambdaHandler,
  });

  const execution = await runner.run({ payload: { userId: "123" } });

  // Assert execution status and result
  expect(execution.getStatus()).toBe("SUCCEEDED");
  expect(execution.getResult()).toEqual({ processedUser: "..." });

  // Assert number of Lambda invocations (initial + replay after the wait)
  expect(execution.getInvocations().length).toBe(2);

  // Assert operations executed
  expect(execution.getOperations()).toHaveLength(3); // 2 steps + 1 wait

  // Inspect individual operations
  const fetchStep = runner.getOperation("fetch-user");
  expect(fetchStep.getStatus()).toBe("SUCCEEDED");
});
```

See the [Testing SDK documentation](./packages/aws-durable-execution-sdk-js-testing/README.md) for more details.

## 🔎 Catching Replay Bugs with ESLint

Because the code outside the steps runs again on every replay, it must be deterministic (see [How It Runs: Replay](#how-it-runs-replay)). The ESLint plugin reports code that breaks this as you write it, such as `Date.now()` or a random value outside a step, and a variable that a step changes. It also reports a durable operation started on the context of the operation it runs in.

```bash
npm install @aws/durable-execution-sdk-js-eslint-plugin @typescript-eslint/parser --save-dev
```

```js
// eslint.config.js
import typescriptParser from "@typescript-eslint/parser";
import durableExecution from "@aws/durable-execution-sdk-js-eslint-plugin";

export default [
  { files: ["**/*.ts"], languageOptions: { parser: typescriptParser } },
  durableExecution.configs["flat/recommended"],
];
```

See the [plugin README](./packages/aws-durable-execution-sdk-js-eslint-plugin/README.md) for the rules and other setups.

## 🛠️ Development

To build and test this repository you need Node.js 22 or later.

```bash
npm ci          # install the dependencies of every workspace package
npm run build   # build the published packages and the examples
npm test        # run the unit tests of every workspace package
npm run lint    # check formatting and lint with Biome
```

- **[CONTRIBUTING.md](CONTRIBUTING.md)** – Pull request guidelines and commit message format
- **[TESTING.md](TESTING.md)** – Test layers, including integration tests against deployed functions
- **[RELEASING.md](RELEASING.md)** – How each package is versioned and published
- **[CHANGELOG.md](CHANGELOG.md)** – What changed in each release

## 💬 Feedback & Support

- **🐛 [Report a Bug](https://github.com/aws/aws-durable-execution-sdk-js/issues/new?template=bug_report.yml)** – Found something broken? Let us know
- **💡 [Request a Feature](https://github.com/aws/aws-durable-execution-sdk-js/issues/new?template=feature_request.yml)** – Share ideas for improvements
- **📖 [Documentation Issue](https://github.com/aws/aws-durable-execution-sdk-js/issues/new?template=documentation.yml)** – Report unclear or missing docs
- **💬 [Discussions](https://github.com/aws/aws-durable-execution-sdk-js/discussions)** – Ask questions and connect with the community

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 🔒 Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for information about reporting security issues.

## 📄 License

This project is licensed under the Apache-2.0 License. See [LICENSE](LICENSE) for details.
