# @aws/durable-execution-sdk-js-cdk

Deploy a [Workflow Studio](../aws-durable-execution-sdk-js-insight-vscode) `.dar`
workflow as an AWS Lambda **durable function**. The handler is **generated from
the `.dar` at CDK synth time** (codegen, not a runtime interpreter), so the
deployed artifact is a normal durable Lambda built on
`@aws/durable-execution-sdk-js`.

## Quick start

```ts
import * as path from "node:path";
import { Duration, Stack } from "aws-cdk-lib";
import { DurableWorkflowFunction } from "@aws/durable-execution-sdk-js-cdk";

export class MyStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const workflow = new DurableWorkflowFunction(this, "OrderWorkflow", {
      darPath: path.join(__dirname, "order.dar"),
      retentionPeriod: Duration.days(7),
    });

    // Invoke via the published alias (durable functions need a qualified id):
    // workflow.alias  →  arn:aws:lambda:…:function:…:live
  }
}
```

That single construct:

1. generates a `withDurableExecution` handler from the workflow,
2. bundles it (with the SDK) via `NodejsFunction`,
3. enables durable execution with an **inferred `executionTimeout`** (see below),
4. publishes a **version** and an **alias** (`live` by default) for qualified
   invocation,
5. **grants the IAM permissions inferred from the workflow's code** (AWS SDK v3
   usage + `chainInvoke` targets) to the function role (see below),
6. **embeds the source `.dar`** in the deployment package plus a
   `workflowStudioDar` tag, so the workflow can be reopened and edited in
   Workflow Studio ("Edit durable Function").

`aws-cdk-lib` (^2.235.0) and `constructs` (^10) are peer dependencies.

`durableConfig` on `lambda.Function` first shipped in aws-cdk-lib **2.235.0**. On an
earlier 2.x, CDK silently drops the unknown property: synth succeeds and a
NON-DURABLE Lambda is deployed, with no error until it is invoked. That is why the
floor is not `^2.0.0`.

## Props

| Prop                       | Default  | Description                                                             |
| -------------------------- | -------- | ----------------------------------------------------------------------- |
| `workflow` / `darPath`     | —        | The workflow object, or a path to a `.dar` file (provide one).          |
| `executionTimeout`         | inferred | Override the durable execution timeout.                                 |
| `retentionPeriod`          | 14 days  | How long Lambda retains execution history (1–90 days).                  |
| `aliasName`                | `"live"` | Alias created for qualified invocation.                                 |
| `grantInferredPermissions` | `true`   | Grant IAM permissions inferred from the code to the role.               |
| `functionProps`            | —        | Extra `NodejsFunction` props (memory, env, layers, bundling overrides). |

## Data flow between nodes

Each operation node's result is bound to a `const` named after the node, so a
later node's code can reference an earlier node's result by name:

```ts
const StepA = await context.step("StepA", async (stepCtx) => {
  return await fetchOrder(event);
});
const StepB = await context.step("StepB", async (stepCtx) => {
  return StepA.total * 1.1; // references StepA's result
});
```

The generator is deterministic: the same `.dar` always produces a byte-identical
handler (clean diffs + durable-replay correctness). This is the same naming the
Studio's "Edit in VS Code" scaffold declares, so authored code and deployed code
agree.

## Supported node kinds

| Node               | Generated call                                                                      |
| ------------------ | ----------------------------------------------------------------------------------- |
| `step`             | `context.step(name, fn, { retryStrategy })`                                         |
| `wait`             | `context.wait(name, { <unit>: value })`                                             |
| `callback`         | `context.waitForCallback(name, submitter, { timeout })`                             |
| `chainInvoke`      | `context.invoke(name, funcId, payload)`                                             |
| `waitForCondition` | `context.waitForCondition(name, check, { initialState, waitStrategy })`             |
| `condition`        | an inline `switch` over the decision expression (one case/branch)                   |
| `group`            | `context.runInChildContext(name, childFn)`                                          |
| `map`              | `context.map(name, items, iteratee, { maxConcurrency, completionConfig, nesting })` |
| `parallel`         | `context.parallel(name, branches, { maxConcurrency, completionConfig })`            |

Retry/wait specs map to `createRetryStrategy` / `createLinearRetryStrategy` /
`createWaitStrategy`; container bodies are generated recursively.

## Error handling

Error **routes** are `"error"`-kind edges out of the failing node (matched by
the edge's `errorType`; blank = catch-all); error **fallbacks** are the node's
`onError` branches (a fallback value has no destination, so it stays on the
node). On failure (after retries), typed entries build an `if (err instanceof
<Type>)` chain — routes first (in edge order), then fallbacks. No routes or
fallbacks = the error propagates (fails the execution).

```ts
let Charge;
try {
  Charge = await context.step("Charge", fn, { retryStrategy });
} catch (err) {
  if (err instanceof TimeoutError) {
    // error edge → runs the target node's tail
  } else if (err instanceof ValidationError) {
    Charge = await (async () => {
      return { refunded: true }; // fallback branch (err in scope)
    })();
  } else {
    throw err; // no catch-all
  }
}
```

An `errorType`-less error edge (or blank-type fallback) is the catch-all
(`else`); the error class named in `errorType` must be in scope in the
generated handler. Supported on step, inline, callback, chainInvoke,
waitForCondition, map, group, parallel and awsJob.

## Execution timeout inference

`executionTimeout` is inferred from the workflow's durable waits — the worst
case along its **longest path** (`wait`s, `callback` timeouts and
`waitForCondition` polling budgets, summed along a path but taking the longest
`condition`/error branch and the slowest `parallel` branch, recursing through
containers), plus a 20% buffer, floored at 60s and capped at one year. Override
it with the `executionTimeout` prop.

## Inferred IAM permissions

The construct scans the workflow's code (recursing through map/group/parallel
bodies and `onError` fallbacks) and grants the permissions it needs to the
function role:

- **AWS SDK v3 usage** — `@aws-sdk/client-<svc>` + `<Xxx>Command` maps to the
  action `<svc>:<Xxx>` (with a curated override map for names that don't follow
  that rule, e.g. `ListObjectsV2Command` → `s3:ListBucket`).
- **`chainInvoke`** — `lambda:InvokeFunction` on the target ARN.

Resources default to `*`; review and tighten as needed. Set
`grantInferredPermissions: false` to opt out and manage IAM yourself. Step code
should use AWS SDK **v3** (`@aws-sdk/client-*`, provided by the runtime) — never
`aws-sdk` (v2).

## Reopen in Workflow Studio

The full `.dar` is embedded in the deployment package as `workflow.dar.json` and
the function is tagged `workflowStudioDar=1`, so Workflow Studio's "Edit durable
Function" can list the function, pull the embedded workflow, and reopen it for
editing.

## Programmatic codegen API

The construct is optional — you can generate the handler yourself:

```ts
import {
  loadWorkflow,
  generateHandler,
  inferExecutionTimeoutSeconds,
  analyzeWorkflowPermissions,
} from "@aws/durable-execution-sdk-js-cdk";

const wf = loadWorkflow("workflow.dar");
const handlerSource = generateHandler(wf); // TypeScript source string
const timeoutSeconds = inferExecutionTimeoutSeconds(wf);
const { statements, warnings } = analyzeWorkflowPermissions(wf); // inferred IAM
```

## Notes & current limitations

- The construct writes generated handlers under
  `.durable-execution-workflows/` in the directory `cdk synth` runs from (so the
  bundler resolves the SDK from your `node_modules`). It is gitignored.
- Bundling emits a benign esbuild `import.meta` warning: the SDK's ESM build has
  an `import.meta.url` fallback that is dead code in the CJS bundle (the
  `__filename` branch is taken instead).
- `waitForCondition` stops when its `stopCondition` (a boolean expression over
  the polling `state`) is truthy; older `.dar` files without one fall back to the
  `{ done: true }` convention.
- `condition` branches must be independent linear tails (no reconvergence).
- `map` `itemsCode` must be deterministic (it runs outside a step).
