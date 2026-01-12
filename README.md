# AWS Durable Execution SDKs for JavaScript

[![Build](https://github.com/aws/aws-durable-execution-sdk-js/actions/workflows/build.yml/badge.svg)](https://github.com/aws/aws-durable-execution-sdk-js/actions/workflows/build.yml)
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

## 📦 Packages

This monorepo contains the following NPM packages:

| Package                                                                                              | Description                                       | NPM                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [@aws/durable-execution-sdk-js](./packages/aws-durable-execution-sdk-js)                             | Core SDK for building durable Lambda functions    | [![npm](https://img.shields.io/npm/v/@aws/durable-execution-sdk-js)](https://www.npmjs.com/package/@aws/durable-execution-sdk-js)                             |
| [@aws/durable-execution-sdk-js-testing](./packages/aws-durable-execution-sdk-js-testing)             | Testing utilities for local development and CI/CD | [![npm](https://img.shields.io/npm/v/@aws/durable-execution-sdk-js-testing)](https://www.npmjs.com/package/@aws/durable-execution-sdk-js-testing)             |
| [@aws/durable-execution-sdk-js-eslint-plugin](./packages/aws-durable-execution-sdk-js-eslint-plugin) | ESLint rules for durable function best practices  | [![npm](https://img.shields.io/npm/v/@aws/durable-execution-sdk-js-eslint-plugin)](https://www.npmjs.com/package/@aws/durable-execution-sdk-js-eslint-plugin) |

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
- **[API Reference](./docs/api-reference/index.md)** – Complete technical reference with type definitions
- **[Concepts & Use Cases](./packages/aws-durable-execution-sdk-js/src/documents/CONCEPTS.md)** – Replay model, best practices, and real-world patterns
- **[Examples](./packages/aws-durable-execution-sdk-js-examples)** – Working examples including hello-world, callbacks, parallel processing, and more

## 🧪 Testing

The testing SDK enables local development and unit testing without deploying to AWS, as well as cloud testing against deployed Lambda functions:

```bash
npm install @aws/durable-execution-sdk-js-testing --save-dev
```

```typescript
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";

// Create runner with skipTime to fast-forward through waits
const runner = new LocalDurableTestRunner({
  handlerFunction: myDurableHandler,
});
await runner.setupTestEnvironment({ skipTime: true });

const result = await runner.run({ userId: "123" });

// Assert execution status
expect(result.getStatus()).toBe("SUCCEEDED");
expect(result.getResult()).toEqual({ processedUser: "..." });

// Assert number of Lambda invocations (initial+replay after wait)
expect(result.getInvocations().length).toBe(2);

// Assert operations executed
const operations = result.getOperations();
expect(operations.length).toBe(3); // 2 steps + 1 wait

// Inspect individual operations
const fetchStep = runner.getOperation("fetch-user");
expect(fetchStep.getStatus()).toBe("SUCCEEDED");
```

See the [Testing SDK documentation](./packages/aws-durable-execution-sdk-js-testing/README.md) for more details.

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
