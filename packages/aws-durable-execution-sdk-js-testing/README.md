# AWS Durable Execution Testing SDK for JavaScript

Test durable functions written with [`@aws/durable-execution-sdk-js`](../aws-durable-execution-sdk-js), locally or against a deployed Lambda function.

> **Note:** Distributed map (`context.distributedMap`) is not supported by the testing library yet. Both runners throw a "not supported" error when they reach a distributed map operation.

## Install

```bash
npm install --save-dev @aws/durable-execution-sdk-js-testing
```

## Quick start

The handler under test:

```typescript
// handler.ts
import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: { userId: string }, context: DurableContext) => {
    const user = await context.step("fetch-user", async () => ({
      id: event.userId,
    }));
    await context.wait({ seconds: 5 });
    return context.step("process-user", async () => ({ ...user, done: true }));
  },
);
```

The test, with Vitest:

```typescript
// handler.test.ts
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { afterAll, beforeAll, expect, it } from "vitest";
import { handler } from "./handler";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }));
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

it("processes the user", async () => {
  const runner = new LocalDurableTestRunner({ handlerFunction: handler });

  const execution = await runner.run({ payload: { userId: "123" } });

  expect(execution.getStatus()).toBe("SUCCEEDED");
  expect(execution.getResult()).toEqual({ id: "123", done: true });
  expect(runner.getOperation("fetch-user").getStepDetails()?.result).toEqual({
    id: "123",
  });
});
```

`LocalDurableTestRunner` runs the handler in the test process against a local checkpoint server. `skipTime: true` skips durable waits and retry delays. So the 5-second wait takes no real time.

## Common uses

### Inspect operations

```typescript
runner.getOperation("my-step"); // first with this name
runner.getOperationByNameAndIndex("my-step", 1); // second with this name
runner.getOperationByIndex(0); // by execution order
runner.getOperationById("abc123");

const op = runner.getOperation("my-step");
op.getStatus();
op.getStepDetails(); // result, error, attempt
op.getWaitDetails(); // waitSeconds
op.getContextDetails();
op.getCallbackDetails();
op.getChildOperations();
```

Each `get...Details` method throws for an operation of another type.

The test result has the whole execution:

```typescript
execution.getStatus();
execution.getResult();
execution.getError(); // only for a failed execution
execution.getOperations(); // or getOperations({ status: OperationStatus.FAILED })
execution.getHistoryEvents();
execution.getInvocations();
execution.print(); // prints a table of the operations
```

### Complete a callback

Start the run without `await`. Wait for the callback, then send its result:

```typescript
import { WaitingOperationStatus } from "@aws/durable-execution-sdk-js-testing";

const running = runner.run({ payload: {} });

const callback = runner.getOperation("wait-for-approval");
await callback.waitForData(WaitingOperationStatus.SUBMITTED);
await callback.sendCallbackSuccess(JSON.stringify({ approved: true }));

const execution = await running;
```

`sendCallbackFailure` and `sendCallbackHeartbeat` work the same way.

### Test chained invokes

Register the functions that the handler invokes:

```typescript
runner
  .registerDurableFunction("workflow-a:1", workflowAHandler)
  .registerFunction("utility-function", utilityHandler);
```

`registerFunction` takes a plain Lambda handler.

### Test a deployed function

`CloudDurableTestRunner` invokes a deployed function and reads its execution history:

```typescript
import { CloudDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";

const runner = new CloudDurableTestRunner({ functionName: "my-function:1" });
const execution = await runner.run({ payload: { userId: "123" } });
expect(execution.getStatus()).toBe("SUCCEEDED");
```

The test needs AWS credentials that can invoke the function and read its history.

### Run a function from the command line

```bash
npx run-durable --skip-time path/to/handler.js
```

See the [run-durable CLI guide](./RUN_DURABLE_CLI.md).

## Advanced

- **Reuse a runner.** Call `runner.reset()` between tests that share one runner instance. It clears the data of the previous execution.
- **Pause and resume.** `runner.pauseExecution()` ends the current invocation of a running local execution. No invocation starts until `runner.resumeExecution()`. Use them to test what replays after an interruption. Both methods are experimental.
- **Mocks.** The handler runs in the test process. So `vi.mock` and other module mocks apply inside steps.
- **Fake timers.** `skipTime: true` installs fake timers. Setup throws when fake timers are already installed, for example by `vi.useFakeTimers()`.
- **Cloud runner options.** `CloudDurableTestRunner` accepts a `client` (a `LambdaClient`) and `config: { pollInterval, invocationType }`. `pollInterval` defaults to 1000 ms. `invocationType` defaults to `InvocationType.RequestResponse`. `waitForData` on a cloud operation needs `InvocationType.Event`.

## Reference

- [run-durable CLI guide](./RUN_DURABLE_CLI.md)
- [Examples with tests](../aws-durable-execution-sdk-js-examples/src/examples)
- [API reference](https://docs.aws.amazon.com/durable-execution/)
- [Source](src/test-runner), with TSDoc on every public method.
- [Contributing](../../CONTRIBUTING.md)

## Security

See [CONTRIBUTING](../../CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This project is licensed under the Apache-2.0 License.
