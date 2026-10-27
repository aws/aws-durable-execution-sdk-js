# @aws/durable-execution-sdk-js-lite-testing

A local test runner for
[`@aws/durable-execution-sdk-js-lite`](../aws-durable-execution-sdk-js-lite/README.md).
`runDurable` runs a durable execution against an in-memory service. It needs no AWS
account.

To change this package, read [Contributing](#contributing) first.

## Status

This package is an alpha. It is private and not published to npm. Its API can change.

## Requirements

- Node.js 22.12 or later. The package has no dependencies.
- The test imports `withDurableExecution` from the lite SDK and builds the handler. The
  runner never imports the SDK. So the package needs no dependency on it.

## Usage

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { withDurableExecution } from "@aws/durable-execution-sdk-js-lite";
import { runDurable } from "@aws/durable-execution-sdk-js-lite-testing";
import { workflow } from "../examples/order-workflow.js";

test("an approved order is confirmed", async () => {
  const run = await runDurable({
    createHandler: (client) => withDurableExecution(workflow, { client }),
    input: { orderId: "o-1" },
    onCallback: () => ({
      result: JSON.stringify({ approved: true, approver: "alice" }),
    }),
    functions: {
      "payment-service:live": () => ({ paymentId: "p-1" }),
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result.status, "CONFIRMED");
  assert.equal(run.getOperation("cooling-off").Type, "WAIT");
});
```

`runDurable` invokes the handler again after each suspension, like Lambda does. It has a
virtual clock: it moves time to the next wait, retry or callback timeout, so tests do not
wait in real time.

## Options

- `createHandler(client)`: returns the handler that `withDurableExecution` builds with this
  client. Pass the same `plugins` as in production, for example
  `(client) => withDurableExecution(workflow, { client, plugins })`. `runDurable` calls it
  once. Each simulated invocation calls every plugin factory again. The fake Lambda context
  has `awsRequestId` `"request-1"`, `"request-2"` and so on. Each invocation event has
  `UpdatedOperationIds`: the ids of the records that changed after the previous
  invocation's last checkpoint response, for example a wait that the virtual clock ended.
- `input` (optional): the execution input.
- `onCallback({ callbackId, name })` (optional): answers each callback. Return
  `{ result: string }` or `{ error: { ErrorType, ErrorMessage } }`. Return `undefined` to leave
  the callback open. The callback that `waitForCallback` creates has no name, so `name` is
  `undefined` for it.
- `functions` (optional): an object that maps a `functionName` to a local function for
  `ctx.invoke`. The function receives `{ input, traceHeader }`. `input` is the parsed
  input, or `{}` without input, as in AWS. `traceHeader` is the `XAmznTraceId` that a plugin's
  `traceHeader` hook set, else `undefined`. Its return value is the invoke result.
  A thrown error fails the invoke with `ErrorType` set to the error's `name`.
- `maxInvocations` (default 100): `runDurable` throws after this many invocations.
- `pageSize` (optional): serves the execution state in pages of this size, to test
  pagination.
- `service` (optional): a service from `createInMemoryService(options)`. The options above
  for the service are then ignored. Pass one to change records during an invocation, as the
  real service does. `service.advanceBy(seconds)` moves the virtual clock and ends the
  waits and retry delays that are due. `service.boundary()` applies the callback answers
  and invoke results. The next checkpoint response reports the changed records.

## Durable functions as invoke targets

`durableFunction(createHandler, options)` returns a `functions` entry that runs a durable
function. Each call runs a new execution with `runDurable`, with its own in-memory service.
`options` are the `runDurable` options for the child, without `createHandler` and `input`.

- A SUCCEEDED child returns its result to the caller's `ctx.invoke`.
- A FAILED child fails the invoke with the child's `ErrorType` and `ErrorMessage`.
- A PENDING child cannot finish in the test. So it fails the invoke with the
  `ErrorMessage` `"PENDING"`.
- The child's operations are in the child's service. So `run.operations` of the caller does
  not contain them.

```js
const run = await runDurable({
  createHandler: (client) => withDurableExecution(orderWorkflow, { client }),
  functions: {
    "payment-service:live": durableFunction((client) =>
      withDurableExecution(paymentWorkflow, { client }),
    ),
  },
});
```

## Recording requests and events

`createHandler` receives the client and returns the handler. So a test can wrap either one.

- Wrap the client to record each checkpoint request and response:
  `(client) => withDurableExecution(workflow, { client: recording(client) })`. The client has
  the methods `checkpoint(request)` and `getExecutionState(request)`.
- Wrap the handler to record each invocation event:
  `(client) => { const h = withDurableExecution(workflow, { client }); return (event, context) => { events.push(event); return h(event, context); }; }`.

## Result

`runDurable` resolves to an object with these fields:

- `status`: `"SUCCEEDED"`, `"FAILED"` or `"PENDING"`. `"PENDING"` means that nothing can make
  progress, for example a callback that `onCallback` left open.
- `result`: the workflow result, when `status` is `"SUCCEEDED"`.
- `error`: `{ ErrorType, ErrorMessage, ErrorData }`, when `status` is `"FAILED"`.
- `operations`: every operation record, in start order. The first is the EXECUTION record.
- `invocations`: the number of invocations.
- `invocationErrors`: the invocation errors that the service would record, in order. One
  is an error that the handler threw. The other is a `PENDING` output while no wait,
  callback, invoke or step retry is pending. The service then invokes again, so
  `runDurable` does too. A test can assert that this list is empty.
- `getOperation(name)`: the first operation record with this name.

## What the in-memory service checks

The in-memory service does not simulate heartbeat timeouts.

The in-memory service rejects some requests that the real service rejects. A rejected request
fails the execution, as in AWS. It rejects:

- a request body larger than 6 MiB plus 11 KiB, the service's limit on the HTTP request;
- a member such as `Name`, `Payload` or `Error.ErrorData` that is not a string;
- an `Id` or `ParentId` that is not 1 to 64 characters of `[a-zA-Z0-9-_]`, a `SubType` that
  is not 1 to 32 such characters, and a `Name` that is not 1 to 256 printable ASCII
  characters. The error is a `ValidationException`;
- a STEP or CONTEXT `Payload` larger than 256 KiB, and a CHAINED_INVOKE `Payload` larger than
  1 MiB;
- a `START` for an operation that exists, unless it is a STEP in status `READY`;
- two updates for one operation in one request, unless a STEP or CONTEXT `START` comes
  first.

## Contributing

This section is for people and AI agents who change this package. The rules of the lite
SDK's [Contributing](../aws-durable-execution-sdk-js-lite/README.md#contributing) section
apply, and so do the repository's [rules for every change](https://github.com/aws/aws-durable-execution-sdk-js/blob/main/CONTRIBUTING.md#rules-for-every-change). The rules below
add to them or replace them for this package:

1. `package.json` has no `dependencies`, no `peerDependencies`, no `devDependencies` and
   no `optionalDependencies`.
2. `src` imports only relative paths and `node:` built-ins. It never imports the lite SDK.
   The test passes the handler through `createHandler`. `src/index.d.ts` imports the lite
   SDK's types by a relative path, because the lite SDK is not linked into the workspace
   `node_modules`.
3. The in-memory service models the real service. Add a check or a behavior only if the
   real service has it, and a test of a user workflow needs it. Copying the full SDK's
   testing API is not a reason.
4. Tests import the lite SDK by a relative path, through `test/helpers.js`.
5. Before a commit, run `npm test` in this folder and `npx biome check
   packages/aws-durable-execution-sdk-js-lite-testing` from the repository root. If
   `src/index.d.ts` changed, also run
   `npx tsc --noEmit --strict --ignoreConfig --module nodenext --target es2022 --skipLibCheck test/types.check.ts`
   in this folder. All must pass.
6. Commit titles use the scope `sdk-lite-testing`, for example
   `feat(sdk-lite-testing): add durableFunction`.

### Files

```
src/index.js              public exports
src/run-durable.js        runDurable: the invocation loop; durableFunction
src/in-memory-service.js  createInMemoryService: records, checks, virtual clock
src/index.d.ts            the public types
```
