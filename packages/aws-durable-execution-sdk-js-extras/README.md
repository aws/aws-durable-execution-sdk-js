# AWS Durable Execution SDK Extras

> **Experimental.** Every API in this package is experimental. It may change or be removed in a future release, without a major version bump.

Ready-made custom operations for the [AWS Durable Execution SDK](../aws-durable-execution-sdk-js). Each operation composes the SDK's built-in operations and calls AWS APIs. The operations live in this package so the core SDK does not depend on those APIs' clients.

## Installation

```bash
npm install @aws/durable-execution-sdk-js @aws/durable-execution-sdk-js-extras
```

This package needs `@aws/durable-execution-sdk-js` 2.6.0 or later. Earlier versions have no `subType` option on steps and callbacks. They would drop the subtypes that these operations record, and replay after an upgrade would then fail.

## `microvm`: run a job in an AWS Lambda MicroVM

`microvm` launches a new [Lambda MicroVM](https://docs.aws.amazon.com/lambda/latest/dg/lambda-microvms-guide.html), delivers the job to it, waits for the job result, and terminates the MicroVM. The function invocation ends while the MicroVM works, so no Lambda compute is billed during the wait.

```typescript
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { microvm } from "@aws/durable-execution-sdk-js-extras/microvm";

export const handler = withDurableExecution(async (event, context) =>
  microvm<{ passed: boolean }>(
    context,
    "build",
    { repo: event.repo, commit: event.commit },
    {
      imageIdentifier: process.env.MICROVM_IMAGE_ARN!,
      executionRoleArn: process.env.MICROVM_ROLE_ARN!,
      timeout: { hours: 1 },
      heartbeatTimeout: { seconds: 60 },
    },
  ),
);
```

The first argument is the context that the call runs in. Inside a child context or a `map` item, pass that context, so the operation's steps belong to it.

### Which operation to use

- One job: use `microvm`.
- Several jobs that share one MicroVM's files and processes: use `microvmSession` (below).

### How the job reaches the MicroVM

The operation picks the delivery from the input size, so the caller does not choose:

1. A job whose `run` hook payload fits in 4096 Unicode code points goes in the `RunMicrovm` request, and Lambda passes it to the `run` lifecycle hook. The service counts code points, not bytes. So an input of about 3,600 code points fits, whether they are ASCII, CJK, or emoji. The payload also holds the callback ID. The MicroVM gets the `NO_INGRESS` connector, so nothing can reach it.
2. A larger job goes over HTTP. The launch request carries no job, and a request step POSTs the job to the MicroVM after it starts. The input is limited only by the HTTP body. The MicroVM gets an ingress connector, and every request uses a short-lived auth token that the operation creates.

The worker package runs its `handler` for both deliveries. So the code in the MicroVM does not change with the input size.

The HTTP delivery waits inside the Lambda invocation until the MicroVM endpoint accepts the job, usually one to two seconds. The `run` hook delivery adds no Lambda time for the boot.

An application that already serves HTTP routes can receive every job on its own route:

```typescript
await microvm(context, "build", input, {
  ...config,
  request: { path: "/clone-build" },
});
```

The route must answer with a 2xx status at once and run the job in the background.

### What it does

The operation runs its durable operations inside one child context named after the first argument:

1. `<name>.callback` creates a durable callback. The service generates the callback ID, and the SDK checkpoints it. So the ID is unique to this call and stays the same on replay.
2. `<name>.launch` calls `RunMicrovm`. The client token is the SHA-256 hex digest of the callback ID. So a retried or replayed launch returns the same MicroVM instead of starting a second one. With `run` hook delivery, the launch request contains the job.
3. With HTTP delivery, `<name>.request` creates an auth token and POSTs the job.
4. The child context waits for the MicroVM to complete the callback.
5. `<name>.terminate` calls `TerminateMicrovm`. It runs after success, failure, and timeout alike.

A terminate failure does not fail the operation. The job result is already recorded at that point. So the operation logs an error instead of throwing. The MicroVM then keeps running, and is billed, until the platform ends it at `maximumDurationInSeconds`, the operation timeout plus 5 minutes. For example, a job with an 8-hour timeout that finishes in 5 minutes leaves its MicroVM running for almost 8 more hours.

### Subtypes

Each durable operation records a subtype, exported as `MicrovmOperationSubType`. Execution history and plugins can filter on it without parsing operation names.

| Operation | Type | Subtype |
|---|---|---|
| `<name>` of `microvm` | Context | `Microvm` |
| `<name>` of `microvmSession` | Context | `MicrovmSession` |
| `<jobName>` of `vm.invoke` | Context | `MicrovmSessionJob` |
| `<name>.session` | Step | `MicrovmSessionId` |
| `<name>.launch` | Step | `MicrovmLaunch` |
| `<name>.request`, `<jobName>.request` | Step | `MicrovmRequest` |
| `<name>.terminate` | Step | `MicrovmTerminate` |
| `<name>.callback`, `<jobName>.callback` | Callback | `MicrovmCallback` |

Replay compares each subtype with the checkpoint. So these values are fixed: a changed value would fail executions in flight.

### Retries in two tiers

A step retry costs one durable operation and one more Lambda invocation. Most failures here are short, so the steps retry in two tiers:

1. **Inside one step attempt.** The AWS SDK client retries throttling and server errors of `RunMicrovm`, `CreateMicrovmAuthToken`, and `TerminateMicrovm`. The request step retries the POST itself: connection errors, 429, and 5xx with a backoff from 250 ms to 4 s, and one 401 or 403 with a new auth token. The endpoint answers this way until the MicroVM's `run` hook returns. This tier ends after `request.retryWindow` (60 seconds by default, between 1 second and 10 minutes), or 10 seconds before the invocation times out.
2. **The step retry strategy.** When the first tier gives up, the step retries after a longer backoff, outside the invocation. `retryStrategy` replaces the default, which allows 5 attempts.

A route that answers another 4xx status fails the operation without a retry.

### Errors

Every MicroVM failure is a `MicrovmError`. Catch the base class for all of them, or a subclass for one kind:

| Error | When |
|---|---|
| `MicrovmLaunchError` | `RunMicrovm` failed after all retries, so no MicroVM runs the job. |
| `MicrovmDeliveryError` | HTTP delivery failed after all retries, or the route answered a 4xx status such as 404. |
| `MicrovmNotRunningError` | A `MicrovmDeliveryError` of a session job: the session's MicroVM is terminating, terminated, or removed. It is not retried. Only a session that checks the MicroVM state before each job reports it. See [Suspending the MicroVM between jobs](#suspending-the-microvm-between-jobs). |
| `MicrovmJobFailedError` | The job handler in the MicroVM failed. The message includes the job's error type, and `errorData` is the data that the MicroVM reported. |
| `MicrovmTimeoutError` | No result arrived within `timeout`, or no heartbeat within `heartbeatTimeout`. A MicroVM that crashed ends this way. |

```typescript
import {
  MicrovmError,
  MicrovmTimeoutError,
} from "@aws/durable-execution-sdk-js-extras/microvm";

try {
  await microvm(context, "build", input, config);
} catch (error) {
  if (error instanceof MicrovmTimeoutError) {
    // The MicroVM crashed or took too long.
  } else if (error instanceof MicrovmError) {
    // Any other MicroVM failure.
  }
}
```

The class is the same on the first run and on every replay, so code that branches on it stays deterministic. Other errors keep their own types:

- An invalid config throws `TypeError` or `RangeError` before any durable operation.
- An error from a session handler's own code is not a `MicrovmError`. It reaches the caller as `ChildContextError`, as from `runInChildContext`.
- An SDK error from a durable operation that the handler ran keeps its type. This covers every type that the SDK rebuilds as its own class: `StepError`, `CallbackError`, `CallbackExternalError`, `CallbackTimeoutError`, `CallbackSubmitterError`, `InvokeError`, `ChildContextError`, `WaitForConditionError`, and `PromiseCombinatorError`.
- A failed terminate is logged, not thrown.

A `MicrovmError` that leaves your own `runInChildContext` reaches the next caller as the SDK's `ChildContextError`. Its cause is a `StepError` whose `cause.name` is the MicroVM error type. The SDK rebuilds every error type it does not know this way.

### Defaults and limits

- The MicroVM gets the `INTERNET_EGRESS` connector. It needs egress to reach the Lambda callback APIs. For ingress, it gets `NO_INGRESS` with `run` hook delivery and `ALL_INGRESS` with HTTP delivery. If you set `ingressNetworkConnectors`, allow ingress whenever an input can exceed the `run` hook limit.
- The operation sets no idle policy. The idle policy counts only inbound endpoint traffic. A job receives none after its delivery, so an idle policy would suspend the MicroVM during the job.
- `timeout` must be between 1 second and 8 hours, because a MicroVM lives at most 8 hours. The MicroVM's `maximumDurationInSeconds` is `timeout` plus 5 minutes, capped at 8 hours.

### Permissions

The function's execution role needs:

- `lambda:RunMicrovm` and `lambda:TerminateMicrovm`. Without `lambda:TerminateMicrovm`, every operation still returns its result, but every MicroVM runs until its timeout plus 5 minutes. The only sign is an error in the function's log.
- `lambda:CreateMicrovmAuthToken`, for HTTP delivery. Grant it unless every input is small.
- `lambda:PassNetworkConnector` on the connectors the MicroVM uses. RunMicrovm authorizes each connector separately. With the defaults, that is `arn:aws:lambda:<region>:aws:network-connector:aws-network-connector:*`.
- `iam:PassRole` on the MicroVM execution role.

The MicroVM execution role (`executionRoleArn`) needs `lambda:SendDurableExecutionCallbackSuccess`, `lambda:SendDurableExecutionCallbackFailure`, and `lambda:SendDurableExecutionCallbackHeartbeat` on the function ARN (`arn:aws:lambda:<region>:<account>:function:<name>:*`).

### The contract with the code in the MicroVM

[`@aws/durable-execution-sdk-js-microvm-worker`](../aws-durable-execution-sdk-js-microvm-worker) implements this contract. Use it, or implement the steps below yourself.

The image must enable the `run` lifecycle hook. The service then also requires the `ready` image hook. Lambda sends the `run` hook a JSON body whose `runHookPayload` field is a JSON string with this shape (exported as `MicrovmRunHookPayload`):

```json
{
  "version": 1,
  "region": "us-east-1",
  "job": {
    "callbackId": "<callback ID>",
    "heartbeatTimeoutSeconds": 60,
    "input": { "repo": "org/app", "commit": "abc123" }
  }
}
```

`job` is present only with `run` hook delivery. With HTTP delivery, the job arrives as the body of a POST to `/durable-execution/v1/job` (exported as `DEFAULT_MICROVM_JOB_PATH`), or to `request.path` when you set one. The body adds `version`, `region`, and `microvmId` (exported as `MicrovmJobRequest`):

```json
{
  "version": 1,
  "region": "us-east-1",
  "microvmId": "<MicroVM ID>",
  "callbackId": "<callback ID>",
  "heartbeatTimeoutSeconds": 60,
  "input": { "repo": "org/app", "commit": "abc123" }
}
```

A job request can arrive before the `run` hook, because the endpoint can accept requests before Lambda has sent the hook. So the body carries the MicroVM ID too. Ignore fields that you do not know, in the job request and in the `run` hook payload: a later release can add optional fields without changing `version`.

The code in the MicroVM must:

1. Return HTTP 200 from the `run` hook within the hook timeout (at most 60 seconds). A failed or timed-out `run` hook can send the MicroVM straight to `TERMINATING`.
2. Answer a job request with a 2xx status at once. The same job can arrive again, also after it ended, so ignore a second request for a callback ID that you already ran. Do not wait for the `run` hook before running a job request.
3. Run each job in the background.
4. Create its AWS clients after the `run` hook or the first job request arrives, not at image build. Lambda snapshots the running process at build time, and every MicroVM from the image shares that state.
5. When `heartbeatTimeoutSeconds` is set, call `SendDurableExecutionCallbackHeartbeat` more often than that interval, for example every third of it.
6. When the job ends, call `SendDurableExecutionCallbackSuccess` with a JSON result (at most 256 KB), or `SendDurableExecutionCallbackFailure` with an error.

## `microvmSession`: send several jobs to one MicroVM

`microvmSession` launches one MicroVM and runs a handler that sends it jobs over HTTP. The jobs share the MicroVM's files and processes, so a later job can use what an earlier job wrote. The session terminates the MicroVM when the handler returns or throws, and returns the handler's value.

```typescript
import { microvmSession } from "@aws/durable-execution-sdk-js-extras/microvm";

const result = await microvmSession(
  context,
  "pipeline",
  {
    imageIdentifier: process.env.MICROVM_IMAGE_ARN!,
    executionRoleArn: process.env.MICROVM_ROLE_ARN!,
    timeout: { hours: 2 }, // the whole session, at most 8 hours
  },
  async (vm, ctx) => {
    const build = await vm.invoke("clone-build", { repo: event.repo }, {
      path: "/clone-build",
      timeout: { minutes: 15 },
      heartbeatTimeout: { seconds: 30 },
    });
    await ctx.waitForCallback("approval", sendApprovalRequest);
    const tests = await vm.invoke("test", { build }, { path: "/test", timeout: { minutes: 10 } });
    return { build, tests };
  },
);
```

The operation tree for this session:

```
pipeline                  Context (MicrovmSession)
├── pipeline.session      Step (MicrovmSessionId): generates the session ID
├── pipeline.launch       Step (MicrovmLaunch): RunMicrovm, client token = SHA-256 of the session ID
├── clone-build           Context (MicrovmSessionJob)
│   ├── clone-build.callback   Callback (MicrovmCallback)
│   └── clone-build.request    Step (MicrovmRequest)
├── approval              WaitForCallback
├── test                  Context (MicrovmSessionJob)
│   ├── test.callback          Callback (MicrovmCallback)
│   └── test.request           Step (MicrovmRequest)
└── pipeline.terminate    Step (MicrovmTerminate)
```

- The session ID is random and checkpointed. So the client token is unique per session and stable across retries and replays.
- The first job is sent right after the launch. The MicroVM endpoint holds or refuses requests until the `run` hook returns, and the request step retries a refused request inside its own attempt. So the session needs no separate readiness wait.
- Each `vm.invoke` works like `microvm` with HTTP delivery, without its own launch and terminate. It returns the job's result. Without `path`, the job goes to the worker's `handler`.
- The session `timeout` sets the MicroVM's lifetime: the service terminates it at the timeout plus 5 minutes. The timeout does not limit the handler or its jobs. A job still running when the MicroVM ends waits for its own `timeout`, which can be up to 8 hours. So set a `heartbeatTimeout` on every `vm.invoke`. The job then fails at its heartbeat timeout after the MicroVM ends.
- A failed `vm.invoke` rejects inside the handler with a `MicrovmError`. The handler can catch it and continue with the same MicroVM. An uncaught error ends the session.
- The handler receives the session's child context as its second argument. Use it for durable operations between jobs, and `ctx.promise.all` to run jobs in parallel.
- Inside `ctx.promise.all`, a failed `vm.invoke` rejects with the SDK's `PromiseCombinatorError`, not with a `MicrovmError`. The MicroVM error type appears only as the `name` of an inner `cause`: `PromiseCombinatorError`, then `StepError`, then an `Error` named, for example, `MicrovmJobFailedError`. When that error ends the session, the checkpoint records only the outer type. So the caller of `microvmSession` gets a `PromiseCombinatorError` with no MicroVM type in its chain. To branch on the MicroVM error type, catch the `PromiseCombinatorError` inside the handler, and read the `name` of its innermost `cause`.
- Inside a nested child context, such as a `map` item, call `vm.withContext(itemCtx).invoke(...)`. A durable operation created in a parent context from inside a child context fails the execution.
- `idlePolicy` is not set by default. The session already suspends an idle MicroVM (see below). An idle policy counts only inbound traffic, so it also counts a running job as idle, because the job receives none. So set it only for a MicroVM that serves inbound traffic of its own, and make `maxIdleDurationSeconds` longer than the longest job.
- The session's value is checkpointed as the child context result. So it must be JSON-serializable, and it counts toward the checkpoint size limit.

### Suspending the MicroVM between jobs

A running MicroVM pays compute charges. A suspended MicroVM pays only for snapshot storage, and it keeps its memory and files. So the worker in a session MicroVM suspends its own MicroVM when it is idle:

1. The session passes the idle time to the worker in the run hook payload. The default is 60 seconds, or the session `timeout` if that is shorter.
2. The worker counts its running jobs. When no job has run for the idle time, it calls SuspendMicrovm with its own MicroVM ID. A job that starts cancels the idle time, so the worker never suspends the MicroVM during a job.
3. The next `vm.invoke` calls GetMicrovm first. It resumes a `SUSPENDED` MicroVM, waits for a `SUSPENDING` one, and then delivers the job to the endpoint that GetMicrovm reports. A new MicroVM that is still booting reports `PENDING`, and the request's own retries wait for it.
4. The MicroVM can suspend itself between that state check and the request. The worker answers every job with 503 from the moment it starts to suspend, because a job accepted then would freeze with the MicroVM. A suspended endpoint answers 502. So after a 502, 503, or 504, or a request that failed without a status, the retry checks the state again, and resumes the MicroVM, before it sends the job again. The wait for the resume counts toward the request's retry window.
5. The worker stops refusing jobs when the `resume` lifecycle hook arrives, or 30 seconds after the suspend. So enable the `resume` hook in the image. Without it, the first job after a resume can wait up to 30 seconds. A `retryWindow` under 30 seconds then ends before the refusal, and the step retry strategy covers the rest. The default strategy does, at the cost of extra invocations. The hook also lets the worker suspend again after a resume that brings no job, for example an idle-policy auto-resume.

```typescript
await microvmSession(ctx, "pipeline", {
  ...config,
  autoSuspendOnIdle: true,              // the default
  autoSuspendIdleTime: { seconds: 60 }, // the default
}, handler);
```

The worker cannot see other work in the MicroVM. So it also suspends the MicroVM in these cases:

- Background processes that an earlier job started.
- A MicroVM that serves inbound traffic that is not a job, such as a preview environment waiting for an approval.

Set `autoSuspendOnIdle: false` for such a workload. A shorter `autoSuspendIdleTime` saves more compute during long waits, and makes back-to-back jobs more likely to pay for a resume. A resume measured in us-east-1 took about 1 second. The job's `timeout` and `heartbeatTimeout` start before the resume, so they include it. Suspending does not extend the MicroVM's lifetime.

The session rejects these settings before it creates any durable operation: an `autoSuspendIdleTime` under 10 seconds, one longer than the session `timeout`, and an `autoSuspendIdleTime` while `autoSuspendOnIdle` is `false`. A session whose `timeout` is under 10 seconds does not suspend by default.

A session MicroVM lives at most its session `timeout` plus 5 minutes, and never longer than 8 hours. What the next `vm.invoke` reports after the MicroVM ends depends on the state check:

- With `autoSuspendOnIdle` on, or an `idlePolicy` set, the request step calls GetMicrovm before each job. A MicroVM that no longer exists, or that is terminating, then fails the job at once with a `MicrovmNotRunningError`. It is a `MicrovmDeliveryError`, and it is not retried.
- With `autoSuspendOnIdle: false` and no `idlePolicy`, the session makes no GetMicrovm call. A terminated MicroVM's endpoint answers 502, measured in us-east-1. The request step treats a 502 as a MicroVM that is still starting. So the job fails with a plain `MicrovmDeliveryError`, only after both retry tiers: 5 step attempts with the default retry strategy, each up to the 60-second `retryWindow`. Each attempt bills Lambda compute while it retries.

The session needs the same permissions as `microvm` with HTTP delivery, including `lambda:CreateMicrovmAuthToken`. It also needs `lambda:GetMicrovm` and `lambda:ResumeMicrovm`. With `autoSuspendOnIdle: false` and no `idlePolicy`, it needs neither.

The MicroVM's execution role needs `lambda:SuspendMicrovm` for the worker's self-suspend. The action authorizes on the MicroVM image, so the statement names the image ARN (`arn:aws:lambda:<region>:<account>:microvm-image:<name>`). A MicroVM can then suspend any MicroVM from the same image, not only itself. So code in one MicroVM can suspend another during its job, and that job then waits until its `heartbeatTimeout` or its `timeout`. Use one image per trust boundary. Without the permission, the worker logs a warning, and the MicroVM keeps running.

## End-to-end test

`e2e/run-e2e.mjs` deploys a durable function and a MicroVM image to a real AWS account and runs twelve scenarios:

- A job that succeeds with heartbeats. Its small input goes in the `run` hook.
- A job that fails.
- A MicroVM that crashes. The heartbeat timeout must end the wait.
- Two jobs in a `map`.
- A job with a 10 KB input and no route. It must go over HTTP to the worker's `handler`.
- A job on a named route with a 10 KB input.
- Two jobs with 3,400 code points of CJK and of emoji input, about 10.6 KB and 13.9 KB. They must go in the `run` hook and reach the MicroVM unchanged.
- A job with 4,200 code points of CJK input. It must go over HTTP.
- A failing job over HTTP.
- A session whose second job reads a file that its first job wrote, with a durable wait between them.
- A session whose last job reads a value that its first job kept in memory, with two durable waits between them. Its idle time is 10 seconds, so the worker suspends the MicroVM during the first wait. The runner polls the MicroVM state and requires `SUSPENDED`.

It checks the execution status, the operation history, and that every MicroVM ends `TERMINATED`.

```bash
npm run build -w packages/aws-durable-execution-sdk-js \
  && npm run build -w packages/aws-durable-execution-sdk-js-extras \
  && npm run build -w packages/aws-durable-execution-sdk-js-microvm-worker
cd packages/aws-durable-execution-sdk-js-extras
AWS_REGION=us-east-1 node e2e/run-e2e.mjs
```

The script creates or reuses resources named `dex-microvm-e2e-*`: an S3 bucket, three IAM roles, one MicroVM image per app build, and a function. It does not delete them. `E2E_SCENARIOS=succeed,fail` runs a subset.
