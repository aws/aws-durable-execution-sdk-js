# @aws/durable-execution-sdk-js-lite

A small AWS Lambda durable execution SDK for JavaScript. It has no dependencies and no build
step.

This package is in development. Its rules and design are in [AGENTS.md](./AGENTS.md).

## Testing

`runDurable` from `@aws/durable-execution-sdk-js-lite/testing` runs a workflow locally against
an in-memory service. It needs no AWS account and no timers. It re-invokes the workflow like
Lambda does and skips virtual time to the next wait, retry or callback timeout.

```js
import { runDurable } from "@aws/durable-execution-sdk-js-lite/testing";
import { workflow } from "./handler.js";

const run = await runDurable({ workflow, input: { orderId: "o-1" } });
// run.status: "SUCCEEDED" | "FAILED" | "PENDING" (stuck, for example on an open callback)
// run.result, run.error, run.operations, run.invocations, run.getOperation(name)
```

Options: `onCallback({ callbackId, name })` answers callbacks with `{ result }` or `{ error }`,
or returns `undefined` to leave them open. `functions` maps function names to local functions
for `ctx.invoke`. `maxInvocations` (default 100) stops runaway executions. `pageSize` serves
the state in pages, to exercise pagination.

Best practice: export the workflow separately from the handler, so tests can run it with
`runDurable`:

```js
export const workflow = async ({ event, ctx }) => {
  // ...
};
export const handler = withDurableExecution(workflow);
```
