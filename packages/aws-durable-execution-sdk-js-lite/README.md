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

## Best practices

- After `ctx.createCallback`, await only durable operations (`ctx.step`, `ctx.wait`, ...)
  until you await `result`. The SDK counts the open callback as blocked at once. A plain
  `await` on something else, such as a timer or a fetch, can let the invocation suspend in
  the middle of it.
- A callback `result` is the raw string the sender sent. Call `JSON.parse` yourself if the
  sender sends JSON.
- `ctx.map` and `ctx.parallel` always run every item, even after an item fails. A failed
  item is recorded in the result, not thrown. Call `throwIfError()` on the result to fail on
  any item error.
- Inside a map item or a parallel branch, use the `ctx` passed to `fn`, not the outer `ctx`.
- For "first one wins", race the operations inside a child context, so the winner is
  recorded and replays the same:

  ```js
  const winner = await ctx.runInChildContext({
    fn: ({ ctx: c }) =>
      Promise.race([c.step({ fn: fetchA }), c.step({ fn: fetchB })]),
  });
  ```

Export the workflow separately from the handler, so tests can run it with `runDurable`:

```js
export const workflow = async ({ event, ctx }) => {
  // ...
};
export const handler = withDurableExecution(workflow);
```
