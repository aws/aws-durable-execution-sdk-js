# Adding New Examples

This guide explains how to add new durable function examples with tests.

## Steps to Add a New Example

### 1. Create the Example File

Create your example in `src/examples/your-example.ts`:

```typescript
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../types";

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
  name: "Block Example",
  description: "Advanced child context example",
};
```

### 2. Add the example config

The example config must be added to the export of the main file. This will automatically generate a catalog which will be used by our tests.

**Configuration options:**

- `name`: Human-readable name (used in function naming)
- `description`: What the example demonstrates
- `durableConfig.RetentionPeriodInDays`: (Default to 7) How long to keep execution history (7-90 days)
- `durableConfig.ExecutionTimeout`: (Default to 60) Max execution time in seconds

### 3. Create the Test File

Create `src/examples/__tests__/your-example.test.ts`:

```typescript
import { handler } from "../your-example";
import { createTests } from "./shared/test-helper";

createTests({
  name: "your-example test",
  functionName: "your-example",
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

The `createTests` helper automatically runs tests with:

- **LocalDurableTestRunner** for unit tests (default)
- **CloudDurableTestRunner** for integration tests (when `NODE_ENV=integration`)

### 4. Run Local Tests

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

- [ ] Created example file in `src/examples/`
- [ ] Created test file in `src/examples/__tests__/`
- [ ] Local tests pass (`npm test`)
- [ ] Integration tests pass in CI/CD

## Troubleshooting

**Test not found in integration run:**

- Verify `functionName` in test matches the example name
