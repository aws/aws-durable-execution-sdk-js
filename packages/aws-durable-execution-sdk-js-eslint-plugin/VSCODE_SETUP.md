# VS Code Setup for the ESLint Plugin

This page is for contributors to this repository. It shows how to see the plugin's
rules in VS Code while you work on the examples.

Biome handles formatting and general linting for the whole repository. ESLint runs
for one reason only: it applies this plugin's `no-nested-durable-operations` rule
to the examples package, because Biome cannot load ESLint plugins. The command
line check is `npm run lint:durable-rules` in `packages/aws-durable-execution-sdk-js-examples`.

To use the plugin in your own project, see the [README](./README.md).

## 1. Install the ESLint extension

Install the extension **ESLint** by Microsoft.

## 2. Build the plugin

The examples package loads the plugin from `dist/`, so build it first. Run this
after every change to the plugin's source:

```bash
npm run build -w packages/aws-durable-execution-sdk-js-eslint-plugin
```

## 3. Open the repository root

Open VS Code on the repository root. `.vscode/settings.json` already turns on the
ESLint extension and limits it to `packages/aws-durable-execution-sdk-js-examples`
through `eslint.workingDirectories`, so it does not overlap with Biome elsewhere.
The rules come from `packages/aws-durable-execution-sdk-js-examples/eslint.config.mjs`.

## 4. Check that it works

Open a file under `packages/aws-durable-execution-sdk-js-examples/src/examples/`.
A durable operation that uses a context from an enclosing operation shows a red
underline. For example, `context-validation/parent-context-in-step` calls
`context.step` inside a step on purpose, to show the runtime error. That call has an
`eslint-disable-next-line` comment. Remove the comment to see the underline and a message that starts with:

> Cannot use the same context object "context" inside its own operation

## 5. Check from the command line

```bash
npm run lint:durable-rules -w packages/aws-durable-execution-sdk-js-examples
```

The command exits with a non-zero code when it finds a nested operation.

## How to fix a finding

Use `runInChildContext` and call the operation on the child context:

```typescript
const result = await context.runInChildContext("task1", async (childCtx) => {
  return await childCtx.step(async () => {
    return "task 1 completed";
  });
});
```

## Troubleshooting

If you don't see errors in VS Code:

1. Check that the ESLint extension is enabled.
2. Open the output panel (View → Output) and select **ESLint**. Look for errors.
3. Check that you built the plugin (step 2). The output panel shows a missing `dist/index.js` as an error.
4. Reload VS Code (Ctrl+Shift+P → "Developer: Reload Window").
5. Check that you opened VS Code on the repository root, not on a single package.
