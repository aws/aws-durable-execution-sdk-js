# Adding New Examples

This guide explains how to add new durable function examples with tests.

## Directory Structure

Examples are organized in two ways:

1. **Nested Group Examples**: Related examples are organized in nested subdirectories within a group

   ```
   src/examples/
     wait-for-callback/
       basic/
         wait-for-callback.ts
         wait-for-callback.test.ts
       timeout/
         wait-for-callback-timeout.ts
         wait-for-callback-timeout.test.ts
       heartbeat/
         wait-for-callback-heartbeat.ts
         wait-for-callback-heartbeat.test.ts
       ...
   ```

2. **Standalone Examples**: Individual examples in their own directory
   ```
   src/examples/
     hello-world/
       hello-world.ts
       hello-world.test.ts
       hello-world.history.json
   ```

## Steps to Add a New Example

### 1. Create the Example Directory

Decide if your example belongs to an existing group or should be standalone:

- **For grouped examples**: Create a new subdirectory within the group (e.g., `src/examples/wait-for-callback/my-variant/`)
- **For standalone examples**: Create a new directory (e.g., `src/examples/my-example/`)

### 2. Create the Example File

Create your example TypeScript file in the chosen directory:

**For Nested Groups**: `src/examples/{group}/{subdirectory}/{example-name}.ts`
**For Standalone**: `src/examples/{example-name}/{example-name}.ts`

```typescript
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types"; // For nested: "../../../types"

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    // Your durable function logic here
    const result = await context.step(async () => {
      return "example result";
    });
    return result;
  },
);

export const config: ExampleConfig = {
  name: "My Example",
  description: "Description of what this example demonstrates",
};
```

**Configuration options:**

- `name`: Human-readable name (used in function naming)
- `description`: What the example demonstrates
- `durableConfig.RetentionPeriodInDays`: (Default: 7) How long to keep execution history (7-90 days)
- `durableConfig.ExecutionTimeout`: (Default: 60) Max execution time in seconds

### 3. Create the Test File

Create a test file in the same directory:

**For Nested Groups**: `src/examples/{group}/{subdirectory}/{example-name}.test.ts`
**For Standalone**: `src/examples/{example-name}/{example-name}.test.ts`

```typescript
import { handler } from "./{example-name}";
import { createTests } from "../../../utils/test-helper"; // For standalone: "../../utils/test-helper"

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should execute successfully with expected result and operations", async () => {
      const execution = await runner.run();

      // Multiple assertions on the same execution
      expect(execution.getResult()).toEqual("example result");
      expect(execution.getOperations()).toHaveLength(2); // adjust based on your example

      // REQUIRED: Must call assertEventSignatures for every test
      assertEventSignatures(execution);
    });
  },
});
```

### 4. (Optional) Add History File

If you want to validate execution history, create a history file:

**For Nested Groups**: `src/examples/{group}/{subdirectory}/{example-name}.history.json`
**For Standalone**: `src/examples/{example-name}/{example-name}.history.json`

The `createTests` helper automatically runs tests with:

- **LocalDurableTestRunner** for unit tests (default)
- **CloudDurableTestRunner** for integration tests (when `NODE_ENV=integration`)

### 5. Run Local Tests

```bash
npm test
```

This runs all tests locally using the testing SDK.

## Integration Tests

When you push to GitHub, the integration test workflow (`.github/workflows/integration-tests.yml`) will:

1. **Setup Stage**:
   - Build all packages
   - Generate the examples catalog from the config
   - For each example:
     - Package the function code
     - Deploy/update Lambda function using `scripts/deploy-lambda.ts`
     - Function name format: `YourExampleName-TypeScript` (or with `-PR-{number}` suffix for PRs)

2. **Test Stage**:
   - Run `npm run test:integration` in examples package
   - Tests automatically use `CloudDurableTestRunner` when `NODE_ENV=integration`
   - Function names are passed via `FUNCTION_NAME_MAP` environment variable

3. **Cleanup Stage**:
   - Delete all deployed Lambda functions

### Run Integration Tests Locally

You can run integration tests locally using the `act` tool:

```bash
# From repository root
npm run test:integration
```

Or manually:

```bash
# From examples package directory
NODE_ENV=integration \
FUNCTION_NAME_MAP='{"your-example":"arn:aws:lambda:us-west-2:123456789012:function:YourExample"}' \
LAMBDA_ENDPOINT="https://lambda.us-west-2.amazonaws.com" \
npm run test:integration
```

## Test Helper API

The `createTests` helper provides a unified interface:

```typescript
createTests({
  handler: DurableLambdaHandler;                    // The handler function to test
  tests: TestCallback<ResultType>;                 // Test definitions
  invocationType?: InvocationType;                  // Optional: 'RequestResponse' | 'Event'
  localRunnerConfig?: LocalDurableTestRunnerSetupParameters; // Optional local test config
});
```

Inside `tests`, you have access to:

- `runner`: Either `LocalDurableTestRunner` or `CloudDurableTestRunner`
- `testHelper`: Object containing:
  - `assertEventSignatures`: **Required** function to validate execution history
  - `isTimeSkipping`: Boolean indicating if time is being skipped in tests
  - `isCloud`: Boolean indicating if running against real Lambda
  - `functionNameMap`: Helper for resolving function names in tests

## Event Signature Validation with `assertEventSignatures`

**IMPORTANT**: Every test **MUST** call `assertEventSignatures(execution)` at the end. This validates that the execution produces the expected sequence of durable execution events.

### How it Works

1. **First Run**: When you first create a test, run it with `GENERATE_HISTORY=true` to create the history file:

   ```bash
   GENERATE_HISTORY=true npm test
   ```

2. **History File Creation**: This generates a `.history.json` file next to your test containing the expected event signatures.

3. **Subsequent Runs**: Normal test runs compare the actual events against the stored history file.

### Example Usage

```typescript
createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should complete workflow successfully", async () => {
      const execution = await runner.run();

      // Your test assertions
      expect(execution.getResult()).toEqual("completed");
      expect(execution.getOperations()).toHaveLength(3);

      // REQUIRED: Validate event signatures
      assertEventSignatures(execution);
    });

    it("should handle callback operations", async () => {
      const callbackOp = runner.getOperation("my-callback");
      const executionPromise = runner.run();

      await callbackOp.waitForData();
      await callbackOp.sendCallbackSuccess("result");

      const execution = await executionPromise;
      expect(execution.getResult()).toEqual("result");

      // REQUIRED: Validate event signatures
      assertEventSignatures(execution);
    });
  },
});
```

### Multiple History Files

For tests with multiple scenarios, you can create separate history files:

```typescript
it("should handle success case", async () => {
  const execution = await runner.run({ scenario: "success" });
  expect(execution.getResult()).toBe("success");

  // Creates/uses example-name-success.history.json
  assertEventSignatures(execution, "success");
});

it("should handle failure case", async () => {
  const execution = await runner.run({ scenario: "failure" });
  expect(execution.getError()).toBeDefined();

  // Creates/uses example-name-failure.history.json
  assertEventSignatures(execution, "failure");
});
```

### Common Test Patterns

```typescript
tests: (runner, { assertEventSignatures, isCloud, isTimeSkipping }) => {
  // Combine tests with identical setup (same runner.run() call)
  it("should execute successfully with expected result and operations", async () => {
    const execution = await runner.run();

    // Multiple assertions on the same execution
    expect(execution.getResult()).toEqual(expectedValue);
    expect(execution.getOperations()).toHaveLength(3);

    // Check operations in order
    const ops = execution.getOperations();
    expect(ops[0].getName()).toBe("step-1");
    expect(ops[1].getName()).toBe("step-2");

    // REQUIRED
    assertEventSignatures(execution);
  });

  // Separate test only when setup is different (different parameters, callbacks, etc.)
  it("should handle callback operations", async () => {
    const callbackOp = runner.getOperation("my-callback");
    const executionPromise = runner.run();

    // Wait for callback to start
    await callbackOp.waitForData();

    // Send callback result
    await callbackOp.sendCallbackSuccess("callback-result");

    const execution = await executionPromise;
    expect(execution.getResult()).toContain("callback-result");

    // REQUIRED
    assertEventSignatures(execution);
  });

  // Environment-specific tests with different setups
  it("should behave differently in cloud vs local", async () => {
    const execution = await runner.run();

    if (isCloud) {
      // Cloud-specific assertions
      expect(execution.getInvocations().length).toBeGreaterThan(1);
    } else {
      // Local-specific assertions
      expect(isTimeSkipping).toBe(true);
    }

    // REQUIRED
    assertEventSignatures(execution);
  });
};
```

## Example Checklist

- [ ] Created example file in appropriate directory structure
- [ ] Created test file in same directory
- [ ] Used correct import paths for test-helper and types
- [ ] Added `assertEventSignatures` parameter to test callback
- [ ] Called `assertEventSignatures(execution)` in every test
- [ ] Generated history files with `GENERATE_HISTORY=true npm test`
- [ ] Local tests pass (`npm test`)
- [ ] Integration tests pass in CI/CD

## SAM CLI

A SAM template has been provided for testing the examples locally using the AWS SAM CLI.
Please follow the [SAM CLI documentation](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-command-reference.html) to get started.

Sample usage:

```
sam local invoke HelloWorld --durable-execution-name "MyLocalDurableExecution"
sam local execution get $DURABLE_EXECUTION_ARN
sam local execution history $DURABLE_EXECUTION_ARN
```

## Troubleshooting

### assertEventSignatures Issues

**Error: "assertEventSignature was not called for test [name]"**

- You forgot to call `assertEventSignatures(execution)` in one or more of your tests
- Make sure every `it()` test calls this function

**Error: "History file [...].history.json does not exist"**

- Run the test with `GENERATE_HISTORY=true npm test` to create the history file
- Make sure the file is committed to your repository

**Error: Event signature mismatch**

- The execution produced different events than expected
- If this is intentional (you changed the function), regenerate the history with `GENERATE_HISTORY=true npm test`
- If not intentional, check your function logic for unintended changes

**TypeError: testResult.getHistoryEvents is not a function**

- You're passing the wrong variable to `assertEventSignatures`
- Pass the `execution` result from `runner.run()`, not `execution.getResult()`

### Test Setup Issues

**Tests timing out:**

- For local tests with time skipping disabled: make sure step retries are not longer than the timeout
