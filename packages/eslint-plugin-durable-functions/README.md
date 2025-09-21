# @amzn/lambda-durable-functions-eslint-js

ESLint plugin for AWS Lambda Durable Functions best practices.

## Installation

```bash
npm install --save-dev @amzn/lambda-durable-functions-eslint-js
```

## Usage

Add the plugin to your ESLint configuration:

```json
{
  "plugins": ["@amzn/lambda-durable-functions-eslint-js"],
  "rules": {
    "@amzn/lambda-durable-functions-eslint-js/no-nested-durable-operations": "error"
  }
}
```

Or use the recommended configuration:

```json
{
  "extends": ["plugin:@amzn/lambda-durable-functions-eslint-js/recommended"]
}
```

## Rules

### `no-nested-durable-operations`

Prevents using the same context object inside its own durable operation.

#### ❌ Incorrect

```javascript
context.step('step1', async () => {
  // Error: Cannot use the same context object inside its own operation
  await context.wait(1000);
  
  const result = await context.step('step2', async () => {
    return "nested step";
  });
  
  return result;
});
```

#### ✅ Correct

```javascript
// Use runInChildContext for nested operations
const result = await context.runInChildContext('block1', async (childCtx) => {
  await childCtx.wait(1000);
  
  const result = await childCtx.step('step2', async () => {
    return "nested step";
  });
  
  return result;
});
```

## Supported Durable Operations

The plugin detects these durable operations:

- `step`
- `wait`
- `waitForCallback`
- `waitForCondition`
- `parallel`
- `map`
- `runInChildContext`

## Why This Rule?

Nesting durable operations with the same context object can cause runtime errors and unexpected behavior in AWS Lambda Durable Functions. This rule helps catch these issues at development time.

## License

Apache-2.0
