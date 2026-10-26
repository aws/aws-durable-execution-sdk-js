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
      heartbeatTimeout: { minutes: 5 },
    },
  ),
);
```

The first argument is the context that the call runs in. Inside a child context or a `map` item, pass that context, so the operation's steps belong to it.

### Which operation to use

- One job: use `microvm`.
- Several jobs that share one MicroVM's files and processes: use `microvmSession` (below).

### How the job reaches the MicroVM

The operation picks the delivery from the input size and the config:

1. A `microvm` job goes in the `RunMicrovm` request when its `run` hook payload fits in 4,096 Unicode code points and its config sets no `request.path`. The payload holds the input, the callback ID, and a few other fields. The service counts code points, not bytes. So a CJK character counts once, like an ASCII character. An emoji counts once for each of its code points. Lambda passes the payload to the `run` lifecycle hook. The MicroVM gets the `NO_INGRESS` connector, so nothing can reach it.
2. Every other job goes over HTTP:
   - A `microvm` job whose `run` hook payload is over 4,096 code points.
   - A `microvm` job whose config sets `request.path`, whatever its size.
   - Every `microvmSession` job.

   The launch request carries no job, and a request step POSTs the job to the MicroVM after it starts. The worker package accepts a job body of at most 6 MiB. The MicroVM gets an ingress connector, and every request uses a short-lived auth token that the operation creates.

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

The operation sends `path` as written, and the worker matches the raw request path. So use the same string in the config and in the route. The path must be an RFC 3986 path that starts with `/`, without a query, a fragment, or a `.` or `..` segment. `fetch` resolves a dot segment before it sends the request, also when the dot is written as `%2e`. Percent-encode any other character, for example a space as `%20`. The operation throws a `TypeError` for any other path, before any durable operation starts.

### What it does

The operation runs its durable operations inside one child context named after the first argument:

1. `<name>.callback` creates a durable callback. The service generates the callback ID, and the SDK checkpoints it. So the ID is unique to this call and stays the same on replay.
2. `<name>.launch` calls `RunMicrovm`. The client token is the SHA-256 hex digest of the callback ID. So a retried or replayed launch returns the same MicroVM instead of starting a second one. With `run` hook delivery, the launch request contains the job.
3. With HTTP delivery, `<name>.request` creates an auth token and POSTs the job.
4. The child context waits for the MicroVM to complete the callback.
5. `<name>.terminate` calls `TerminateMicrovm`. It runs after success, failure, and timeout alike.

A terminate failure does not fail the operation. The job result is already recorded at that point. So the operation logs an error instead of throwing. The MicroVM then keeps running, and is billed, until the platform ends it at `maximumDurationInSeconds`, the operation timeout plus 5 minutes, at most 8 hours. For example, a job with an 8-hour timeout that finishes in 5 minutes leaves its MicroVM running for almost 8 more hours.

The terminate step runs only when the operation sees the job's outcome. In these cases it never does, and the MicroVM also runs until its maximum duration:

- A `map` or `parallel` completes early, for example with `minSuccessful`, while an item still waits for its MicroVM. The SDK never runs that item again.
- The execution fails, times out, or is stopped while the operation waits.
- A launch attempt that timed out or lost its connection can still have created a MicroVM. When the launch step still fails, the operation never learns that MicroVM's ID. So it cannot terminate that MicroVM.

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
2. **The step retry strategy.** When the first tier gives up, the step retries after a longer backoff, outside the invocation. `retryStrategy` replaces the default, which allows 5 attempts. The default retries throttling, server errors, state conflicts, connection failures, and timeouts. It does not retry `ValidationException`, `AccessDeniedException`, `ResourceNotFoundException`, `ServiceQuotaExceededException`, or `InsufficientCapacityException`, because a later attempt fails the same way.

A route that answers another 4xx status fails the operation without a retry. So does a redirect, 3xx. The operation does not follow redirects. The server sets the `Location` header. A query in the `Location` can hold a secret, for example a presigned signature. The error message is checkpointed. So the message names the path, and the status of a 3xx answer. It omits the `Location`, and the URL that a followed redirect reached. Set the path that the route serves, for example with its trailing slash. A custom `fetch` must honor `init.redirect`.

### Errors

Every MicroVM failure is a `MicrovmError`. Catch the base class for all of them, or a subclass for one kind:

| Error | When |
|---|---|
| `MicrovmLaunchError` | `RunMicrovm` failed after all retries. A MicroVM can still run the job. The list below the table says when. |
| `MicrovmDeliveryError` | HTTP delivery failed after all retries, or the route answered a 4xx status such as 404, or a redirect. |
| `MicrovmNotRunningError` | A `MicrovmDeliveryError`: the MicroVM is terminating, terminated, or removed. It is not retried. A session that checks the MicroVM state before each job reports it. Any job over HTTP also reports it when `CreateMicrovmAuthToken` reports the MicroVM removed. See [Suspending the MicroVM between jobs](#suspending-the-microvm-between-jobs) and [Suspending after a job](#suspending-after-a-job). |
| `MicrovmJobFailedError` | The job handler in the MicroVM failed. The message includes the job's error type, and `errorData` is the data that the MicroVM reported. |
| `MicrovmTimeoutError` | No result arrived within `timeout`, or no heartbeat within `heartbeatTimeout`. A MicroVM that crashed ends this way. |

After `MicrovmLaunchError`, the delivery decides whether a MicroVM runs the job:

1. With `run` hook delivery, the launch request holds the job. A launch attempt that timed out or lost its connection can still have created a MicroVM. That MicroVM then runs the job. So running the job again after this error can run it twice.
2. With HTTP delivery, the launch request holds no job. The request step starts only after a launch succeeds. So when you invoke through a version or an alias, no MicroVM runs the job.

A failed AWS call keeps its request ID in the error message, in the form `<Operation> request ID: <id>.`, for example `RunMicrovm request ID: <id>.`. A support case can quote it. This applies to `RunMicrovm`, `GetMicrovm`, `ResumeMicrovm`, `CreateMicrovmAuthToken`, and `TerminateMicrovm`. The SDK checkpoints the message. So the handler sees the request ID on the first run and on replay, and the execution history keeps it. A failed `TerminateMicrovm` call does not fail the operation. So a `TerminateMicrovm` request ID appears only in the terminate log entry and in the terminate step record. A message has no request ID when the AWS SDK error or output carries none, for example after a connection failure. A message also has no request ID when the error does not come from the Lambda MicroVMs service. For example, a `client` with role-assuming credentials calls STS inside each call, and an STS error carries the request ID of STS, not of the MicroVM operation. Each step adds the request ID to the message of the AWS SDK error itself, and does not wrap the error. So the error keeps its class, `name`, and `$retryable`. For an AWS SDK error, a custom `retryStrategy` receives the message without the request ID. So a strategy that matches the message, such as `createRetryStrategy({ retryableErrors: [/^Rate exceeded$/] })`, decides on the message of the service. After the strategy returns or throws, the error has the message with the request ID again. An error that the MicroVM operation creates itself, such as `MicrovmStateError` or "RunMicrovm returned no microvmId", has the request ID in its message when the strategy receives it. A custom client can throw one error object for several calls. The message then names only the last call.

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
- A missing `executionRoleArn` throws `TypeError` before any durable operation. `RunMicrovm` accepts a launch without a role. The MicroVM then cannot call the durable callback APIs, so it cannot report the job result.
- An empty `imageIdentifier` or `executionRoleArn` is not checked before the launch. `RunMicrovm` rejects it with `ValidationException`, which is not retried. So the operation fails with `MicrovmLaunchError`.
- A job input over `MAX_JOB_INPUT_BYTES` throws `RangeError` before any durable operation. A job input that `JSON.stringify` cannot encode throws `TypeError` before any durable operation. See [Job inputs](#job-inputs).
- An error from a session handler's own code is not a `MicrovmError`. It reaches the caller as `ChildContextError`, as from `runInChildContext`.
- An SDK error from a durable operation that the handler ran keeps its type. This covers every type that the SDK rebuilds as its own class: `StepError`, `CallbackError`, `CallbackExternalError`, `CallbackTimeoutError`, `CallbackSubmitterError`, `InvokeError`, `ChildContextError`, `WaitForConditionError`, and `PromiseCombinatorError`.
- A failed terminate is logged, not thrown.

A `MicrovmError` that leaves your own `runInChildContext` reaches the next caller as the SDK's `ChildContextError`. Its cause is a `StepError` whose `cause.name` is the MicroVM error type. The SDK rebuilds every error type it does not know this way.

### Defaults and limits

- The MicroVM gets the `INTERNET_EGRESS` connector. It needs egress to reach the Lambda callback APIs. For ingress, it gets `NO_INGRESS` with `run` hook delivery and `ALL_INGRESS` with HTTP delivery. If you set `ingressNetworkConnectors`, allow ingress whenever an input can exceed the `run` hook limit.
- The operation sets no idle policy. The idle policy counts only inbound endpoint traffic. A job receives none after its delivery, so an idle policy would suspend the MicroVM during the job.
- `timeout` must be between 1 second and 8 hours, because a MicroVM lives at most 8 hours. The MicroVM's `maximumDurationInSeconds` is `timeout` plus 5 minutes, capped at 8 hours.
- A job input can have at most `MAX_JOB_INPUT_BYTES` bytes as UTF-8 JSON: 6,283,264 bytes, 6 MiB minus 8 KiB. The worker accepts a job body of at most 6 MiB. The body adds less than 3 KiB of fields to the input. `microvm` and `vm.invoke` reject a larger input with a `RangeError` before any durable operation starts. The limit applies to both deliveries. See [Job inputs](#job-inputs).
- `heartbeatTimeout` starts when the callback is created, before the launch. So it must cover the launch, with its retries, and the boot. A throttled launch can take several minutes. With a shorter heartbeat timeout, the operation fails with `MicrovmTimeoutError` before the MicroVM sends its first heartbeat.
- The request step needs at least 11 seconds left in the invocation when it starts. It keeps a 10-second reserve before the invocation times out, and it starts a call only with at least 1 second left before the reserve. The launch step can run earlier in the same invocation, so the function timeout must cover it too. A function timeout of `retryWindow` plus 11 seconds, 71 seconds by default, leaves the first retry tier about its whole window. With less than 11 seconds left, every attempt fails with `MicrovmEndpointUnavailableError`, and the message of the final `MicrovmDeliveryError` names the function timeout. The Lambda default timeout is 3 seconds. With it, `microvm` runs small jobs in the `run` hook and fails every job that goes over HTTP: a job too large for the hook, a job with `request.path`, and every `microvmSession` job.

### Permissions

The function's execution role needs:

- `lambda:RunMicrovm` and `lambda:TerminateMicrovm`. Without `lambda:TerminateMicrovm`, every operation still returns its result, but every MicroVM runs until its timeout plus 5 minutes, at most 8 hours. The only sign is an error in the function's log.
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
    const build = await vm.invoke(ctx, "clone-build", { repo: event.repo }, {
      path: "/clone-build",
      timeout: { minutes: 15 },
      heartbeatTimeout: { seconds: 30 },
    });
    await ctx.waitForCallback("approval", sendApprovalRequest);
    const tests = await vm.invoke(ctx, "test", { build }, {
      path: "/test",
      timeout: { minutes: 10 },
      heartbeatTimeout: { seconds: 30 },
    });
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
- Each `vm.invoke(ctx, name, input, options)` works like `microvm` with HTTP delivery, without its own launch and terminate. It returns the job's result. Without `path`, the job goes to the worker's `handler`.
- `vm.invoke` takes the context first, as `microvm` does. It creates the job's durable operations in that context. Pass the context that the call runs in: the handler's `ctx`, or a nested one, such as a `map` item's context. A durable operation created in a parent context from inside a child context fails the execution.
- The session `timeout` sets the MicroVM's lifetime: the service terminates it at the timeout plus 5 minutes. The timeout does not limit the handler or its jobs. When the image enables the `terminate` hook, a job still running when the service terminates the MicroVM fails at once, with a `MicrovmJobFailedError` whose message names `MicrovmTerminatedError`. Lambda does not call the hook for a suspended MicroVM. Such a job, or any job when the hook is disabled, waits for its own `timeout`, which can be up to 8 hours. So set a `heartbeatTimeout` on every `vm.invoke`. The job then fails at its heartbeat timeout after the MicroVM ends.
- A failed `vm.invoke` rejects inside the handler with a `MicrovmError`. The handler can catch it and continue with the same MicroVM. An uncaught error ends the session.
- The handler receives the session's child context as its second argument. Use it for durable operations between jobs, and `ctx.promise.all` to run jobs in parallel.
- Inside `ctx.promise.all`, a failed `vm.invoke` rejects with the SDK's `PromiseCombinatorError`, not with a `MicrovmError`. The MicroVM error type appears only as the `name` of an inner `cause`: `PromiseCombinatorError`, then `StepError`, then an `Error` named, for example, `MicrovmJobFailedError`. When that error ends the session, the checkpoint records only the outer type. So the caller of `microvmSession` gets a `PromiseCombinatorError` with no MicroVM type in its chain. To branch on the MicroVM error type, catch the `PromiseCombinatorError` inside the handler, and read the `name` of its innermost `cause`.
- `idlePolicy` is not set by default. With `autoSuspendOnIdle: true`, the session suspends an idle MicroVM itself (see below). An idle policy counts only inbound traffic, so it also counts a running job as idle, because the job receives none. So set it only for a MicroVM that serves inbound traffic of its own, and make `maxIdleDurationSeconds` longer than the longest job.
- The session's value is checkpointed as the child context result. So it must be JSON-serializable, and it counts toward the checkpoint size limit.

### Suspending the MicroVM between jobs

A running MicroVM pays compute charges. A suspended MicroVM pays only for snapshot storage, and it keeps its memory and files. With `autoSuspendOnIdle: true`, the worker in a session MicroVM suspends its own MicroVM when it is idle.

Suspending is off by default, for three reasons:

1. The function's role needs `lambda:GetMicrovm` and `lambda:ResumeMicrovm`. Without them, every job fails.
2. The MicroVM's role needs `lambda:SuspendMicrovm` on the image. That permission lets any MicroVM of the image suspend any other.
3. Background processes that an earlier job started stop while the MicroVM is suspended.

Without it, a session needs only the permissions of `microvm` with HTTP delivery. With it on:

1. The session passes the idle time to the worker in the run hook payload. The default is 60 seconds, or the session `timeout` if that is shorter.
2. The worker counts its running jobs. When no job has run for the idle time, it calls SuspendMicrovm with its own MicroVM ID. A job that starts cancels the idle time, so the worker never suspends the MicroVM during a job.
3. The next `vm.invoke` calls GetMicrovm first. It resumes a `SUSPENDED` MicroVM, waits for a `SUSPENDING` one, and then delivers the job to the endpoint that GetMicrovm reports. A new MicroVM that is still booting reports `PENDING`, and the request's own retries wait for it.
4. The MicroVM can suspend itself between that state check and the request. The worker answers every job with 503 from the moment it starts to suspend, because a job accepted then would freeze with the MicroVM. A suspended endpoint answers 502. So after a 502, 503, or 504, or a request that failed without a status, the retry checks the state again, and resumes the MicroVM, before it sends the job again. The wait for the resume counts toward the request's retry window.
5. The worker stops refusing jobs when the `resume` lifecycle hook arrives, or 30 seconds after the suspend. So enable the `resume` hook in the image. Without it, the first job after a resume can wait up to 30 seconds. A `retryWindow` under 30 seconds then ends before the refusal, and the step retry strategy covers the rest. The default strategy does, at the cost of extra invocations. The hook also lets the worker suspend again after a resume that brings no job, for example an idle-policy auto-resume.

```typescript
await microvmSession(ctx, "pipeline", {
  ...config,
  autoSuspendOnIdle: true,              // off by default
  autoSuspendIdleTime: { seconds: 60 }, // the default when suspending is on
}, handler);
```

The worker cannot see other work in the MicroVM. So it also suspends the MicroVM in these cases:

- Background processes that an earlier job started.
- A MicroVM that serves inbound traffic that is not a job, such as a preview environment waiting for an approval.

Leave suspending off for such a workload. A shorter `autoSuspendIdleTime` saves more compute during long waits, and makes back-to-back jobs more likely to pay for a resume. A resume measured in us-east-1 took about 1 second. The job's `timeout` and `heartbeatTimeout` start before the resume, so they include it. Suspending does not extend the MicroVM's lifetime.

The session rejects these settings before it creates any durable operation: an `autoSuspendIdleTime` under 10 seconds, one longer than the session `timeout`, and an `autoSuspendIdleTime` while `autoSuspendOnIdle` is not `true`. With suspending on, a session whose `timeout` is under 10 seconds still does not suspend by default.

The worker reads its idle time once, from the run hook payload of the launch. RunMicrovm sets the idle policy once, at the launch. So a deploy that changes `autoSuspendOnIdle` or `idlePolicy` does not change what a running MicroVM does. The resume mode says whether each job checks the MicroVM state, and resumes a suspended MicroVM, before delivery. The launch checkpoint records the resume mode in its `resumeBeforeDelivery` field. Replay follows the recorded resume mode, not the current config. So a deploy changes the resume mode only for sessions that launch after it.

A session MicroVM lives at most its session `timeout` plus 5 minutes, and never longer than 8 hours. What the next `vm.invoke` reports after the MicroVM ends depends on the state check:

- For a session that launched with `autoSuspendOnIdle: true`, or with an `idlePolicy` set, the request step calls GetMicrovm before each job. A MicroVM that no longer exists, or that is terminating, then fails the job at once with a `MicrovmNotRunningError`. It is a `MicrovmDeliveryError`, and it is not retried. The message ends with the request ID of the call that reported the state, for example `GetMicrovm request ID: <id>.`
- By default, a session launches with neither. Such a session makes no GetMicrovm call before delivery, unless an earlier job of the handle set `suspendAfter`. A terminated MicroVM's endpoint answers 502, measured in us-east-1. The request step treats a 502 as a MicroVM that is still starting. So the job fails with a plain `MicrovmDeliveryError`, only after both retry tiers: 5 step attempts with the default retry strategy, each up to the 60-second `retryWindow`. Each attempt bills Lambda compute while it retries.
- Every session, and every `microvm` job over HTTP, calls CreateMicrovmAuthToken before the first request, and again after a 401 or 403. The API model lists `ResourceNotFoundException` for that call. That answer fails the job at once with a `MicrovmNotRunningError`, whose message ends with `CreateMicrovmAuthToken request ID: <id>.`. The live service's answer for a removed MicroVM is not verified.

The session needs the same permissions as `microvm` with HTTP delivery, including `lambda:CreateMicrovmAuthToken`. A session that launched with `autoSuspendOnIdle: true` or an `idlePolicy` also needs `lambda:GetMicrovm` and `lambda:ResumeMicrovm`. A later deploy that turns them off does not change the resume mode of such a session. So keep `lambda:GetMicrovm` and `lambda:ResumeMicrovm` until every such session has ended.

With `autoSuspendOnIdle: true`, the MicroVM's execution role needs `lambda:SuspendMicrovm` for the worker's self-suspend. The action authorizes on the MicroVM image, so the statement names the image ARN (`arn:aws:lambda:<region>:<account>:microvm-image:<name>`). A MicroVM can then suspend any MicroVM from the same image, not only itself. So code in one MicroVM can suspend another during its job, and that job then waits until its `heartbeatTimeout` or its `timeout`. Use one image per trust boundary. Without the permission, the worker logs a warning, and the MicroVM keeps running.

### Suspending after a job

`suspendAfter: true` in the options of `vm.invoke` asks the worker to suspend the MicroVM after this job. It is an option of one job, not of the session. `microvm` rejects it in `config.request` with a `TypeError`, because `microvm` terminates its MicroVM after its one job. A value that is not a boolean throws a `TypeError` too, before the job's durable operations start.

```typescript
const result = await microvmSession(context, "pipeline", config, async (vm, ctx) => {
  const build = await vm.invoke(ctx, "build", input, {
    timeout: { minutes: 15 },
    suspendAfter: true,
  });
  await ctx.waitForCallback("approval", sendApprovalRequest);
  return vm.invoke(ctx, "deploy", build, {
    timeout: { minutes: 10 },
    heartbeatTimeout: { seconds: 120 },
  });
});
```

What happens:

1. The job request carries `"suspendAfter": true`. The job document stays at version 1, and the field is omitted for every other job. The run hook payload never carries it.
2. The worker acknowledges the field with the header `X-Microvm-Suspend-After: accepted` in its 202 answer.
3. The worker suspends the MicroVM when the job has ended and its outcome is reported, and no other job runs. A job that ends while another job runs leaves the request pending. The worker then suspends the MicroVM when the last running job ends.
4. The worker suspends the MicroVM that its `run` hook named. It never uses the MicroVM ID of a job request.
5. Each later job of the session handle checks the MicroVM state before delivery, and resumes a suspended MicroVM, as with `autoSuspendOnIdle`. It also checks the state again after a 502, 503, or 504, or a request without an answer. A denied GetMicrovm fails the job, as in that mode. The `suspendAfter` job itself checks the state too, because the record is set before the job starts.

The setting works with or without `autoSuspendOnIdle`. With both, the worker suspends right after the job, and the idle time applies after each resume.

The record that a job set `suspendAfter` is kept in memory only. A replay of a completed job calls `vm.invoke` again, so it sets the record again. A replay of a completed `map` item, `parallel` branch, or child context does not run its function again. So a later job outside that context skips the state check.

Use `suspendAfter` only on the job before a long wait, such as a durable wait or a callback:

- Not on back-to-back jobs. Each suspend writes a snapshot, and each resume adds about 1 second before the next job.
- Not on `map` items. A request waits until no job runs. So a `map` with `suspendAfter` on its items suspends and resumes between items that do not overlap.
- Not on the last job. The session terminates the MicroVM after its handler returns, so the snapshot is wasted.

It needs:

1. The `resume` hook in the image. Without it, the worker refuses the next job with HTTP 503 for up to 30 seconds after the suspend.
2. A `heartbeatTimeout` on the next job of at least its `retryWindow` plus 30 seconds. The heartbeat timeout starts before delivery, so it includes the resume and the refusal.
3. `lambda:GetMicrovm` and `lambda:ResumeMicrovm` in the function's role.
4. `lambda:SuspendMicrovm` on the image in the MicroVM's role. That permission lets code in any MicroVM of the image suspend any other. So use one image per trust boundary.
5. A worker that supports the field. An older worker ignores it, and the MicroVM keeps running. The session then logs one warning: `the worker in MicroVM <id> does not support suspendAfter. The MicroVM keeps running after the job.`

A suspend that the service refuses for now, such as a throttle or expired credentials, is not retried without `autoSuspendOnIdle`. The MicroVM then keeps running until a later suspend. With `autoSuspendOnIdle`, the worker tries again after the idle time, as it does for an idle suspend.

## Best practices for MicroVM operations

The operations retry network and service failures. They launch and terminate the MicroVM. They do not check every setting of your function and your deploy. This section lists what your durable function and your deploy must do. Each rule states what happens if you break it. The rules for the job handlers in the MicroVM are in the worker's [best practices for job handlers](../aws-durable-execution-sdk-js-microvm-worker/README.md#best-practices-for-job-handlers).

### Deploys and versions

1. Invoke the durable function through a published version or an alias, not `$LATEST`.
   - Lambda pins an execution that starts through a version or an alias to that version. So every replay and every step retry runs the same code and the same environment variables. See [Invoking Lambda durable functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-invoking.html).
   - Lambda does not pin an execution that starts through `$LATEST`. After a deploy, the execution resumes on the new code.
   - So under `$LATEST`, a launch step that retries after a deploy can fail with `MicrovmLaunchError`. A MicroVM that an earlier attempt of that step created can then keep running, and be billed, until its maximum duration: the operation timeout plus 5 minutes, at most 8 hours.
2. Read a launch setting inside a step when it comes from a source that can change during an execution. Examples are SSM Parameter Store, AppConfig, and S3 objects.
   - Version pinning does not cover such a source. So a value read outside a step can differ between two attempts of the launch step.
   - A changed value can fail the launch, as in rule 1.
   - A step checkpoints its result. So every replay, and every retry of the launch, uses the value that the step read.
3. Under `$LATEST`, let executions from an earlier build end before you deploy a new build.
   - The MicroVM packages are experimental. A new release can change the durable operations that they create and the fields of their checkpoints.
   - So an execution that replays on a newer build can fail.
   - An execution that started through a version or an alias keeps its build.

### Function timeout

1. Set the function timeout so that each request step starts with at least 11 seconds left in the invocation.
   - The request step keeps a 10-second reserve before the invocation times out. It starts a call only with at least 1 second left before the reserve. [Defaults and limits](#defaults-and-limits) explains both.
   - So an attempt of the request step that starts with less than 11 seconds left fails at once.
   - With a function timeout under 11 seconds, every attempt fails. The job then fails with a `MicrovmDeliveryError` whose message says to raise the function timeout.
   - Every job over HTTP has a request step. So the Lambda default timeout of 3 seconds fails every such job.
2. To give the first retry tier its whole window, set the function timeout to `request.retryWindow` plus 11 seconds, 71 seconds with the default window. Add the time of the launch step, which can run in the same invocation. With a shorter timeout, the first tier ends early, and the step retry strategy makes more attempts, each in another invocation.
3. On a compute other than Lambda, give the durable function a Lambda context whose `getRemainingTimeInMillis()` returns the time left in milliseconds, or give it no Lambda context. The operations read the function from `context.lambdaContext`.
   - Without the function, or with a result that is not a finite number, the request step assumes no deadline. Only the retry window then limits the first tier.
   - A `getRemainingTimeInMillis()` that throws fails the request step with its error. The default retry strategy does not retry a plain `Error`. So the job fails with `MicrovmDeliveryError`. The core SDK reads such a reader as no deadline. The MicroVM operations fail instead.

### Job inputs

1. Pass an input whose JSON form is the value that the job needs.
   - The operation sends `JSON.stringify(input)`. The worker passes the parsed JSON to the handler.
   - `microvm` and `vm.invoke` encode the input once, when you call them. So a `toJSON` method runs once per call. The size check measures that text, and the job body sends that same text.
   - So `NaN` and `Infinity` arrive as `null`, a `Date` arrives as a string, and a property whose value is `undefined` is missing.
   - A value that `JSON.stringify` cannot serialize, such as a `BigInt`, fails the call before any durable operation starts. The call throws a `TypeError` whose message names the operation. Its `cause` is the error of `JSON.stringify`.
2. Keep the input's JSON form within `MAX_JOB_INPUT_BYTES` (6,283,264 bytes, 6 MiB minus 8 KiB). Pass larger data by reference, for example as an S3 key.
   - The job body is the input as UTF-8 JSON, plus the callback ID and a few other fields.
   - The worker refuses a job body over 6 MiB (6,291,456 bytes), and does not run the job.
   - The other fields take less than 3 KiB. So an input within the limit always fits in the body.
   - `microvm` and `vm.invoke` measure the input in UTF-8 bytes of `JSON.stringify(input)`. So "é" counts 2 bytes, and "😀" counts 4.
   - `microvm` and `vm.invoke` reject a larger input with a `RangeError` before any durable operation starts.
   - So an oversized `microvm` input launches no MicroVM. An oversized `vm.invoke` input sends no request.
3. If you set `ingressNetworkConnectors`, allow ingress for every job that goes over HTTP.
   - A `microvm` job goes over HTTP when its `run` hook payload exceeds 4,096 code points, or when it sets `request.path`. Every `microvmSession` job goes over HTTP.
   - The operation passes your connectors to `RunMicrovm` as they are.
   - So without ingress, a job over HTTP cannot reach the MicroVM, and the job fails.
   - See [How the job reaches the MicroVM](#how-the-job-reaches-the-microvm).

### The HTTP job route

1. Answer the job at the route itself, with a 2xx status. Do not redirect, and do not put a proxy that redirects in front of the route.
   - The operation does not follow redirects.
   - So a 3xx answer fails the job with `MicrovmDeliveryError`, without a retry. See [Retries in two tiers](#retries-in-two-tiers).
2. Write the path by the rules in [How the job reaches the MicroVM](#how-the-job-reaches-the-microvm), and not under `/aws/lambda-microvms/`. The lifecycle hooks use that prefix. `microvm` and `vm.invoke` reject any other path with a `TypeError`, before any durable operation starts.

### Sessions and auto-suspend

1. Set `autoSuspendOnIdle: true` whenever you set `autoSuspendIdleTime`. Set `autoSuspendIdleTime` to at least 10 seconds, and to at most the session `timeout`.
   - Without `autoSuspendOnIdle: true`, `microvmSession` rejects any `autoSuspendIdleTime` with a `TypeError`.
   - With it, `microvmSession` rejects an `autoSuspendIdleTime` under 10 seconds, or longer than the session `timeout`, with a `RangeError`.
   - `microvmSession` rejects with either error before it starts any durable operation. See [Suspending the MicroVM between jobs](#suspending-the-microvm-between-jobs).
2. Change `autoSuspendOnIdle` or `idlePolicy` only in a new published version.
   - Under `$LATEST`, a launch step that retries after the change can fail with `MicrovmLaunchError`, as [Deploys and versions](#deploys-and-versions) describes.
   - A session that launched before the change keeps the resume mode that it recorded. See [Suspending the MicroVM between jobs](#suspending-the-microvm-between-jobs).
3. Set `suspendAfter` only on the job before a long wait, and give the next job a `heartbeatTimeout` of at least its `retryWindow` plus 30 seconds.
   - On back-to-back jobs and `map` items, each suspend and resume adds latency and a snapshot.
   - A shorter heartbeat timeout can fail the next job with `MicrovmTimeoutError` while the MicroVM resumes.
   - Keep `lambda:GetMicrovm` and `lambda:ResumeMicrovm` in the function's role after a deploy that removes `suspendAfter`, until every session that ran such a job has ended. See [Suspending after a job](#suspending-after-a-job).
4. Pass `vm.invoke` the context that the call runs in: the session handler's `ctx`, or a nested context such as a `map` item's context. Do not pass the outer `context` of the durable function. A durable operation that is created in a parent context from inside a child context fails the execution. See [`microvmSession`](#microvmsession-send-several-jobs-to-one-microvm).
5. Call `vm.invoke(ctx, name, input, options)` with the context first, and pass `microvmSession` a function as its handler. The TypeScript types require both.
   - The session calls the handler after the launch, inside its child context. So a handler that is not a function fails the session with a `TypeError`, wrapped in `ChildContextError`, after the MicroVM has launched. The terminate step still ends the MicroVM.
   - `vm.invoke` checks the job name, the options, and the input, and then calls `runInChildContext` on its first argument. So a first argument that is not a durable context makes `vm.invoke` throw a `TypeError`, after the MicroVM has launched. A call in the shape `vm.invoke(name, input, options)` rejects before that, with the `TypeError` of the job name or options check. When the error ends the handler, the terminate step still ends the MicroVM.

### Retry strategies

1. Keep the default retry strategy unless you need another policy. A `retryStrategy` replaces it for the launch, request, and terminate steps.
   - The default decides by `error.name`, by the Node.js `code` of a connection error, and by the AWS SDK's `$retryable` field. It allows 5 attempts. [Retries in two tiers](#retries-in-two-tiers) lists the errors that it retries.
   - A strategy that does not retry throttling or connection errors fails the terminate step on such an error.
   - So the MicroVM keeps running, and is billed, until its maximum duration.
2. In a custom strategy, match an AWS error by `error.name`, or with `instanceof` on its AWS SDK class.
   - The name is the error code that the service returns, such as `ThrottlingException`.
   - The API model defines these names. It does not define the message text.
   - So a strategy that matches `error.message` can change its decisions when the service changes a message.

### Custom clients and test fakes

1. Keep the AWS SDK's default retry settings on a custom `client`.
   - The client retries throttling and server errors inside one step attempt.
   - With `maxAttempts: 1`, each such error ends the step attempt.
   - The step retry strategy then waits 2 to 16 seconds between attempts, and allows 5 attempts in total.
   - So a short burst of throttling can use up the 5 attempts and fail the step.
2. Make a custom `client` or a fake return outputs in the AWS SDK shape, with `$metadata`, and throw the AWS SDK's error classes.
   - A `RunMicrovm` output without `microvmId` fails the launch with `MicrovmLaunchError`.
   - The default retry strategy reads `name`, `code`, and `$retryable`. So it does not retry a plain `Error` without a connection error `code`.
   - The operations add the request ID only to the message of a `LambdaMicrovmsServiceException` whose `$metadata.requestId` is set. A plain error, or a frozen one, keeps its message without the request ID.
3. In tests, mock the client with `aws-sdk-client-mock`, and reject with the AWS SDK's error classes, for example `new ThrottlingException({ $metadata: {}, message: "Rate exceeded" })`. Create a new error object for each call. An error object that a fake throws for several calls gets a message that names only the last call. See [Errors](#errors).

### Permissions and monitoring

1. Grant `lambda:TerminateMicrovm` with the other actions in [Permissions](#permissions). Without it, every MicroVM runs, and is billed, until its maximum duration.
2. Create an alarm on the terminate failure log line, for example with a CloudWatch Logs metric filter.
   - A failed terminate does not fail the operation. The operation logs an error whose message starts with `MicroVM "<name>": terminate failed for <id>`.
   - The MicroVM then keeps running, and is billed, until its maximum duration: the `timeout` plus 5 minutes, at most 8 hours.
   - The log line is the only sign of the failure. So only an alarm on it reports the failure.
   - In the cases that [What it does](#what-it-does) lists, the terminate step never runs, and no log line appears.

## End-to-end test

`e2e/run-e2e.mjs` deploys a durable function and a MicroVM image to a real AWS account and runs thirteen scenarios by default:

- A job that succeeds with heartbeats. Its small input goes in the `run` hook.
- A job that fails.
- A MicroVM that crashes. The heartbeat timeout must end the wait.
- A MicroVM that the runner terminates 5 seconds after it is `RUNNING`, during a 600-second job. The worker's `terminate` hook must fail the job within a minute, long before its 300-second heartbeat timeout.
- Two jobs in a `map`.
- A job with a 10 KB input and no route. It must go over HTTP to the worker's `handler`.
- A job on a named route with a 10 KB input.
- Two jobs with 3,400 code points of CJK and of emoji input, about 10.6 KB and 13.9 KB. They must go in the `run` hook and reach the MicroVM unchanged.
- A job with 4,200 code points of CJK input. It must go over HTTP.
- A failing job over HTTP.
- A session whose second job reads a file that its first job wrote, with a durable wait between them.
- A session whose last job reads a value that its first job kept in memory, with two durable waits between them. Its idle time is 10 seconds, so the worker suspends the MicroVM during the first wait. The runner polls the MicroVM state and requires `SUSPENDED`.

It checks the execution status, the operation history, and that every MicroVM ends `TERMINATED`. Two more scenarios, `long-job` and `idle-probe`, take minutes and answer design questions. They run only when `E2E_SCENARIOS` names them.

`e2e/probe-lifecycle.mjs` records when Lambda calls the `suspend` and `terminate` hooks, and which headers the hook calls and forwarded requests carry. It needs the roles and the bucket that `run-e2e.mjs` creates, so run that first.

```bash
npm run build -w packages/aws-durable-execution-sdk-js \
  && npm run build -w packages/aws-durable-execution-sdk-js-extras \
  && npm run build -w packages/aws-durable-execution-sdk-js-microvm-worker
cd packages/aws-durable-execution-sdk-js-extras
AWS_REGION=us-east-1 node e2e/run-e2e.mjs
```

The script creates or reuses resources named `dex-microvm-e2e-*`: an S3 bucket, three IAM roles, one MicroVM image per app build, and a function. It does not delete them. `E2E_SCENARIOS=succeed,fail` runs a subset.
