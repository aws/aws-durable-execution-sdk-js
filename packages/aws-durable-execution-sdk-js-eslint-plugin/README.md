# AWS Durable Execution ESLint Plugin

ESLint rules for AWS Lambda durable functions. They report code that breaks replay.

## How replay works

A durable function works by replay. When an execution continues after a wait, a
callback, a retry, or a failure, Lambda runs your handler again from the beginning.
The SDK then walks through the code up to the point where the previous run stopped:

- At a step that already finished, the SDK returns the step's saved result. It does
  not run the step's function again.
- At the first operation that has not finished, the SDK runs it and saves its result.

So the code inside a step runs when the step executes, and the code outside the
steps runs again on every replay.

**The code outside a step must be deterministic.** The SDK identifies each durable
operation by its position: the first operation called on a context, the second, and
so on. On replay it matches each call to the saved operation at the same position.
Given the same saved results, your code must make the same calls in the same order.
Anything that can give a different answer the second time belongs inside a step.
That includes the current time, random numbers, UUIDs, and API calls whose results
change.

Two rules in this plugin protect this requirement: `no-non-deterministic-outside-step`
and `no-closure-in-durable-operations`. A third rule, `no-nested-durable-operations`,
checks how durable operations are nested.

## Requirements

- ESLint 8.57 or later, 9, or 10, using the flat config format (`eslint.config.js`).
  CI tests ESLint 8.57, the latest 9, and 10. `@typescript-eslint/parser` 8 needs
  the same ESLint versions.
- Node.js 22 or later.
- A parser for TypeScript files, such as `@typescript-eslint/parser`.

The plugin does not support the legacy eslintrc format. See
[Legacy eslintrc configuration](#legacy-eslintrc-configuration).

## Installation

```bash
npm install --save-dev @aws/durable-execution-sdk-js-eslint-plugin @typescript-eslint/parser
```

`@typescript-eslint/parser` lets ESLint read TypeScript. A JavaScript-only project
does not need it. Remove the `languageOptions.parser` lines from the examples below.

## Usage

Add the recommended config to your `eslint.config.js`. It enables all three rules
as errors.

```js
// eslint.config.js
import typescriptParser from "@typescript-eslint/parser";
import durableExecution from "@aws/durable-execution-sdk-js-eslint-plugin";

export default [
  {
    files: ["**/*.ts"],
    languageOptions: { parser: typescriptParser },
  },
  durableExecution.configs["flat/recommended"],
];
```

In a CommonJS project, use `require` instead:

```js
// eslint.config.js
const typescriptParser = require("@typescript-eslint/parser");
const durableExecution = require("@aws/durable-execution-sdk-js-eslint-plugin");

module.exports = [
  {
    files: ["**/*.ts"],
    languageOptions: { parser: typescriptParser },
  },
  durableExecution.configs["flat/recommended"],
];
```

The recommended config has no `files` setting, so it applies to every file ESLint
checks. To limit it to your durable functions, spread it into your own object:

```js
{
  ...durableExecution.configs["flat/recommended"],
  files: ["src/handlers/**/*.ts"],
}
```

ESLint 8.57 uses flat config when it finds an `eslint.config.js` or
`eslint.config.mjs` file. ESLint 9 and 10 always use it.

### Choose the rules yourself

Register the plugin under a name you pick, then turn on the rules you want. This
example uses the name `durable`:

```js
// eslint.config.js
import durableExecution from "@aws/durable-execution-sdk-js-eslint-plugin";

export default [
  {
    files: ["**/*.ts"],
    plugins: { durable: durableExecution },
    rules: {
      "durable/no-nested-durable-operations": "error",
      "durable/no-closure-in-durable-operations": "error",
      "durable/no-non-deterministic-outside-step": "warn",
    },
    // languageOptions: { parser: ... } for TypeScript, as above
  },
];
```

### Rule names in the recommended config

The recommended config registers the plugin as `@aws/durable-functions`. ESLint
shows that name in its output, and you use it in `eslint-disable` comments:

```ts
// eslint-disable-next-line @aws/durable-functions/no-nested-durable-operations
```

### Legacy eslintrc configuration

The plugin cannot be loaded from an eslintrc file such as `.eslintrc.json`. ESLint
adds the prefix `eslint-plugin-` to the name of a plugin in an eslintrc file and
then looks for that package. For this package it looks for
`@aws/eslint-plugin-durable-execution-sdk-js-eslint-plugin`, which does not exist.
ESLint 10 removed eslintrc.

Earlier versions of this README showed `extends:
["plugin:@aws/durable-execution-sdk-js-eslint-plugin/recommended"]`. That setup
never worked. If you have a project that still uses eslintrc, move it to flat
config, or follow ESLint's
[migration guide](https://eslint.org/docs/latest/use/configure/migration-guide).

The exported `configs.recommended` is the legacy form of the config. It is
deprecated and remains only so that code which reads its `rules` keeps working.

## Rules

All three rules are in `flat/recommended` as errors.

| Rule                                                                      | What it reports                                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`no-nested-durable-operations`](#no-nested-durable-operations)           | A durable operation started on the context of the operation it runs in    |
| [`no-closure-in-durable-operations`](#no-closure-in-durable-operations)   | A variable declared outside a step that the step changes                  |
| [`no-non-deterministic-outside-step`](#no-non-deterministic-outside-step) | Non-deterministic code outside a step, such as the time and random values |

### `no-nested-durable-operations`

Prevents using the same context object inside its own durable operation.

A step is one unit of work, and it cannot contain other durable operations. To group
operations, run them in a child context with `runInChildContext`, and call them on
the child context.

Checked operations: `step`, `wait`, `waitForCallback`, `waitForCondition`,
`parallel`, `map` and `runInChildContext`.

#### ❌ Incorrect

```typescript
const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    return await context.step("step1", async () => {
      // Error: Cannot use the same context object inside its own operation
      await context.wait({ seconds: 1 });

      const result = await context.step("step2", async () => {
        return "nested step";
      });

      return result;
    });
  },
);
```

#### ✅ Correct

```typescript
// Use runInChildContext for nested operations
const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    return await context.runInChildContext("block1", async (childCtx) => {
      await childCtx.wait({ seconds: 1 });

      const result = await childCtx.step("step2", async () => {
        return "nested step";
      });

      return result;
    });
  },
);
```

#### Known limitation

The rule finds the context by looking for the parameter of an arrow function or a
function expression, or for a variable declared in the file. It does not
recognize a context that is the parameter of a function declaration, such as
`async function handler(event, context) { ... }`, so it reports nothing there.
Write the handler as an arrow function, as in the examples above, to get the
check.

### `no-closure-in-durable-operations`

Prevents modifying closure variables inside durable operations. Reading closure
variables is allowed.

The function of a step does not run again on replay, so a change it makes to a
variable outside the step does not happen on replay. The code after the step then
sees a different value than it saw on the first run, which makes that code
non-deterministic. To pass a value out of a step, return it from the step.

Checked operations: `step`, `runInChildContext`, `waitForCondition` and
`waitForCallback`.

#### ❌ Incorrect

```typescript
const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    let a = 2;
    const result = await context.runInChildContext(
      async (childContext: DurableContext) => {
        const stepResult = await childContext.step(async () => {
          // Error: this step does not run again on replay, so this change to 'a' is lost
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

```typescript
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

### `no-non-deterministic-outside-step`

Requires non-deterministic code to run inside a step. Code outside a step runs
again on every replay, so it has to give the same answer each time. A step's result
is saved, so a replay reads the saved value instead of running the call again.

The rule reports these calls when they are written outside a step callback:

- `Math.random()`
- `Date.now()` and `new Date()` with no arguments
- `performance.now()`
- `crypto.randomBytes()` and `crypto.getRandomValues()`
- Any call whose name contains `uuid`, such as `crypto.randomUUID()` or `uuidv4()`

The rule checks where the call is written. That includes the body of a helper
function that you define outside the step. It also reports a call to a helper that
contains one of these calls, directly or through other functions, when the call to
the helper is outside a step.

#### ❌ Incorrect

```typescript
const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    // Error: this code runs again on every replay, and both values change
    const orderId = crypto.randomUUID();
    const startedAt = Date.now();

    await context.step("charge", async () => chargeCard(orderId));
    return { orderId, startedAt };
  },
);
```

#### ✅ Correct

```typescript
const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    // The step saves these values, so a replay returns the same ones
    const { orderId, startedAt } = await context.step(
      "create-order",
      async () => ({ orderId: crypto.randomUUID(), startedAt: Date.now() }),
    );

    await context.step("charge", async () => chargeCard(orderId));
    return { orderId, startedAt };
  },
);
```

## Why These Rules?

Replay runs the code outside the steps once on the first run, and again on every
replay. The SDK can resume an execution correctly only if each run makes the same
durable calls in the same order. The first two rules below protect that requirement.
The third protects the structure of nested operations.

### No Non-Deterministic Code Outside a Step

Code that reads the clock or generates a random value gives a different answer on
each run. If it runs outside a step, a replay can compute a different value than
the first run did. A later `if` statement can then take another branch, and the code
makes different durable calls than the ones the SDK saved. Wrapping the call in a
step saves its result, so every replay reads the same value.

### No Closure in Durable Operations

A step's function does not run again on replay. If it changes a variable outside
the step, the first run sees the change and a replay does not. The code after the
step then works with different values on the two runs. Return the value from the
step instead, because the SDK saves what a step returns.

Reading closure variables is safe because it doesn't change state. Only mutations
(assignments, increments, decrements) are problematic.

### No Nested Durable Operations

A durable operation that uses the same context as the operation it runs in can cause
runtime errors and unexpected behavior. The SDK expects grouped work to run in a
child context. This rule helps catch these issues at development time.

## License

Apache-2.0
