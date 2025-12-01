# AWS Durable Execution ESLint Plugin

ESLint plugin for AWS Durable Execution SDK best practices.

## Installation

```bash
npm install --save-dev @aws/durable-execution-sdk-js-eslint-plugin
```

## Usage

Add the plugin to your ESLint configuration:

```json
{
  "plugins": ["@aws/durable-execution-sdk-js-eslint-plugin"],
  "rules": {
    "@aws/durable-execution-sdk-js-eslint-plugin/no-nested-durable-operations": "error",
    "@aws/durable-execution-sdk-js-eslint-plugin/no-closure-in-durable-operations": "error"
  }
}
```

Or use the recommended configuration:

```json
{
  "extends": ["plugin:@aws/durable-execution-sdk-js-eslint-plugin/recommended"]
}
```

## Rules

### `no-nested-durable-operations`

Prevents using the same context object inside its own durable operation.

#### ❌ Incorrect

```javascript
context.step("step1", async () => {
  // Error: Cannot use the same context object inside its own operation
  await context.wait(1000);

  const result = await context.step("step2", async () => {
    return "nested step";
  });

  return result;
});
```

#### ✅ Correct

```javascript
// Use runInChildContext for nested operations
const result = await context.runInChildContext("block1", async (childCtx) => {
  await childCtx.wait(1000);

  const result = await childCtx.step("step2", async () => {
    return "nested step";
  });

  return result;
});
```

### `no-closure-in-durable-operations`

Prevents modifying closure variables inside durable operations. Reading closure variables is allowed.

#### ❌ Incorrect

```javascript
const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    let a = 2;
    const result = await context.runInChildContext(
      async (childContext: DurableContext) => {
        const stepResult = await childContext.step(async () => {
          // Error: Modifying 'a' from outer scope causes replay inconsistency
          a = a + 1;
          return "child step completed";
        });
        return stepResult;
      },
    );
    return result;
  },
);
```

#### ✅ Correct

```javascript
const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    let a = 2;
    const result = await context.runInChildContext(
      async (childContext: DurableContext) => {
        const stepResult = await childContext.step(async () => {
          // Reading 'a' is OK
          const value = a + 1;
          return value;
        });
        return stepResult;
      },
    );
    return result;
  },
);

// Or use local variables
const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.runInChildContext(
      async (childContext: DurableContext) => {
        const stepResult = await childContext.step(async () => {
          let a = 2;
          a = a + 1;
          return "child step completed";
        });
        return stepResult;
      },
    );
    return result;
  },
);
```

## Supported Durable Operations

The plugin detects these durable operations:

- `step`
- `runInChildContext`
- `waitForCondition`
- `waitForCallback`
- `wait`
- `parallel`
- `map`

## Why These Rules?

### No Nested Durable Operations

Nesting durable operations with the same context object can cause runtime errors and unexpected behavior in AWS Lambda durable functions. This rule helps catch these issues at development time.

### No Closure in Durable Operations

During replay, durable functions skip already-executed steps. If a closure variable is modified inside a step, the modification won't occur during replay, causing different outcomes between initial execution and replay. This leads to non-deterministic behavior and potential bugs.

Reading closure variables is safe because it doesn't change state. Only mutations (assignments, increments, decrements) are problematic.

## License

Apache-2.0
