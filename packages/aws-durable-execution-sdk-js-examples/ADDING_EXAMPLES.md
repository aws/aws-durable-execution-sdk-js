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
import { createTests } from "../../shared/test-helper"; // For nested: "../../../shared/test-helper"

createTests({
  name: "my-example test",
  functionName: "{example-name}",
  handler,
  tests: (runner) => {
    it("should return expected result", async () => {
      const execution = await runner.run();
      expect(execution.getResult()).toEqual("example result");
    });

    it("should execute correct number of operations", async () => {
      const execution = await runner.run();
      expect(execution.getOperations()).toHaveLength(2); // adjust based on your example
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
  name: string;              // Test suite name
  functionName: string;      // Must match handler filename (without .ts)
  handler: Function;         // The handler function to test
  invocationType?: string;   // Optional: 'RequestResponse' | 'Event'
  tests: (runner, isCloud) => void;  // Test definitions
});
```

Inside `tests`, you have access to:

- `runner`: Either `LocalDurableTestRunner` or `CloudDurableTestRunner`
- `isCloud`: Boolean indicating if running against real Lambda

### Common Test Patterns

```typescript
tests: (runner, isCloud) => {
  it("should return expected result", async () => {
    const execution = await runner.run();
    expect(execution.getResult()).toEqual(expectedValue);
  });

  it("should execute operations in order", async () => {
    const execution = await runner.run();
    const ops = execution.getOperations();
    expect(ops[0].name).toBe("step-1");
    expect(ops[1].name).toBe("step-2");
  });

  it("should execute correct number of operations", async () => {
    const execution = await runner.run();
    expect(execution.getOperations()).toHaveLength(3);
  });
};
```

## Example Checklist

- [ ] Created example file in appropriate directory structure
- [ ] Created test file in same directory
- [ ] Used correct import paths for test-helper and types
- [ ] Local tests pass (`npm test`)
- [ ] Integration tests pass in CI/CD

## Troubleshooting

**Test not found in integration run:**

- Verify `functionName` in test matches the example name
