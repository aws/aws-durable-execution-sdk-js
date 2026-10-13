# AWS Durable Execution ESLint Plugin

ESLint rules that catch mistakes which break replay in AWS Lambda durable functions.

A durable function runs again from the start each time it resumes. The SDK skips
the steps that already finished and returns their saved results. Code that behaves
differently on the second run, such as a random value or a variable changed inside
a step, gives different results on replay. These rules report that code while you
write it.

## Requirements

- ESLint 8.57 or later, using the flat config format (`eslint.config.js`).
  ESLint 8.57, 9 and 10 are tested.
- Node.js 22 or later.
- A parser for TypeScript files, such as `@typescript-eslint/parser`.

The plugin does not support the legacy eslintrc format. See
[Legacy eslintrc configuration](#legacy-eslintrc-configuration).

## Installation

```bash
npm install --save-dev @aws/durable-execution-sdk-js-eslint-plugin
```

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

ESLint 8.57 uses flat config when it finds an `eslint.config.js` file. ESLint 9 and
10 always use it.

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

| Rule                                                                      | What it reports                                                      |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`no-nested-durable-operations`](#no-nested-durable-operations)           | A durable operation that uses the same context as the one running it |
| [`no-closure-in-durable-operations`](#no-closure-in-durable-operations)   | A variable from an outer scope that a durable operation changes      |
| [`no-non-deterministic-outside-step`](#no-non-deterministic-outside-step) | Random values, the current time and UUIDs outside a step             |

### `no-nested-durable-operations`

Prevents using the same context object inside its own durable operation.

Checked operations: `step`, `wait`, `waitForCallback`, `waitForCondition`,
`parallel`, `map` and `runInChildContext`.

#### ❌ Incorrect

```javascript
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

```javascript
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

Checked operations: `step`, `runInChildContext`, `waitForCondition` and
`waitForCallback`.

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

### `no-non-deterministic-outside-step`

Requires code that gives a different answer on each run to run inside a step. The
SDK saves a step's result, so a replay reads the saved value. Code outside a step
runs again on every replay and produces a new value.

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

```javascript
const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    // Error: both values change on every replay
    const orderId = crypto.randomUUID();
    const startedAt = Date.now();

    await context.step("charge", async () => chargeCard(orderId));
    return { orderId, startedAt };
  },
);
```

#### ✅ Correct

```javascript
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

### No Nested Durable Operations

Nesting durable operations with the same context object can cause runtime errors
and unexpected behavior in AWS Lambda durable functions. This rule helps catch
these issues at development time.

### No Closure in Durable Operations

During replay, durable functions skip already-executed steps. If a closure variable
is modified inside a step, the modification won't occur during replay, causing
different outcomes between initial execution and replay. This leads to
non-deterministic behavior and potential bugs.

Reading closure variables is safe because it doesn't change state. Only mutations
(assignments, increments, decrements) are problematic.

### No Non-Deterministic Code Outside a Step

A replay runs the code between steps again. If that code reads the clock or
generates a random value, the replay sees a different value than the first run. A
later step can then take a different path from the one the saved results describe.
Wrapping the call in a step saves its result, so every replay reads the same value.

## License

Apache-2.0
