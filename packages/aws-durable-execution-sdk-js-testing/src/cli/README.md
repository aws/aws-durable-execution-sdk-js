# run-durable CLI

A command-line tool to quickly run and test durable functions locally without writing test code.

## Usage

From the monorepo root:

```bash
npm run run-durable <path-to-handler-file>
```

From the testing package:

```bash
npm run run-durable <path-to-handler-file>
```

## Examples

```bash
# Run hello-world example
npm run run-durable packages/aws-durable-execution-sdk-js-examples/src/examples/hello-world.ts

# Run comprehensive operations
npm run run-durable packages/aws-durable-execution-sdk-js-examples/src/examples/comprehensive-operations.ts

# Run step with retry
npm run run-durable packages/aws-durable-execution-sdk-js-examples/src/examples/step-with-retry.ts
```

## Output

The CLI will:

1. Start a local checkpoint server
2. Execute the durable function
3. Print a table of all operations with details (name, type, status, timing)
4. Display the execution status
5. Show the result (or error if failed)

## Requirements

- The file must export a `handler` or `default` export
- The handler must be wrapped with `withDurableFunctions()`
