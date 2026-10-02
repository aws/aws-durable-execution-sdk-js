# AWS Durable Execution SDK MicroVM Worker

> **Experimental.** Every API in this package is experimental. It may change or be removed in a future release, without a major version bump.

Runs inside an AWS Lambda MicroVM. It receives jobs from the durable function's [`microvm` operation](../aws-durable-execution-sdk-js-extras), sends heartbeats while each job runs, and reports each job's result or error to the durable function.

## Usage

```typescript
import { startMicrovmWorker } from "@aws/durable-execution-sdk-js-microvm-worker";

await startMicrovmWorker<{ repo: string }, { passed: boolean }>({
  // Jobs from microvm(ctx, name, input, config), and from vm.invoke without a
  // path. A small job arrives in the run hook, a large one over HTTP. The
  // handler receives both the same way.
  handler: async (input, context) => {
    const passed = await runBuild(input.repo, { signal: context.signal });
    return { passed };
  },
  // Jobs sent to a named route: request: { path: "/clone-build" } in microvm,
  // or path: "/clone-build" in vm.invoke.
  routes: {
    "/clone-build": async (input, context) => cloneAndBuild(input, context.signal),
  },
});
```

The worker needs `handler`, `routes`, or both. A handler's resolved value becomes the result of `microvm(context, ...)` in the durable function. A rejection fails that call with the error's name and message, cut to 256 and 8,192 characters. The stack is not sent, like the core SDK, so the image's file paths stay out of the durable execution history. `context.signal` is aborted when the durable function stops waiting, for example after a heartbeat timeout. The handler should then stop its work.

## Image configuration

Start the worker when the image's process starts. Lambda snapshots the process after the `ready` hook, so the worker must already be listening.

The image needs these hook settings in `CreateMicrovmImage`:

```json
{
  "hooks": {
    "port": 8080,
    "microvmHooks": {
      "run": "ENABLED",
      "runTimeoutInSeconds": 10,
      "resume": "ENABLED",
      "resumeTimeoutInSeconds": 10
    },
    "microvmImageHooks": { "ready": "ENABLED" }
  }
}
```

- The `run` hook delivers the job, or tells the worker that jobs arrive over HTTP. So it must be enabled.
- The `resume` hook tells a session's worker that its MicroVM runs again after a suspend. It is optional, and recommended for sessions (see below).
- The service requires the `ready` hook whenever a lifecycle hook is enabled. The worker answers it with HTTP 200.
- `port` must match the worker's port. `startMicrovmWorker` listens on 8080 by default, which is also the port the MicroVM endpoint forwards to. Pass another port as its second argument.

## What the worker does

On `POST /aws/lambda-microvms/runtime/v1/run` the worker:

1. Validates the run hook payload.
2. Answers HTTP 200 at once, because a slow or failed `run` hook can terminate the MicroVM.
3. Runs `handler` for the payload's job, when it has one. A payload without a job belongs to a MicroVM whose jobs arrive over HTTP.

On `POST <route>` the worker validates the job request, answers HTTP 202 at once, and runs the route's handler. `POST /durable-execution/v1/job` (exported as `MICROVM_JOB_PATH`) runs `handler`. That path is reserved, so a route cannot use it. A job request can arrive before the `run` hook. Until the `run` hook arrives, the worker takes the MicroVM ID for `context.microvmId` from the first job request that has a `microvmId`. The `run` hook's ID then replaces it for later jobs. Without either, `context.microvmId` is `"unknown"`.

For every job, the worker:

1. Sends a heartbeat when the job starts, when the durable function set a heartbeat timeout. It then sends one about every third of `heartbeatTimeoutSeconds`. Each wait is shortened by 1 to 2 seconds, so MicroVMs that start together do not send heartbeats at the same moments. The amount comes from a hash of the job's callback ID, not from `Math.random`. Lambda restores every MicroVM from one snapshot of the worker process, so `Math.random` could return the same values in each of them.
2. Calls `SendDurableExecutionCallbackSuccess` with the handler's result, or `SendDurableExecutionCallbackFailure` with its error. It makes up to 5 attempts, and each attempt ends after 30 seconds, so a request on a dead connection is retried instead of waiting minutes for the TCP timeout. All attempts together take at most about 165 seconds. Heartbeats keep running until the outcome is reported, so a stalled attempt does not let a short heartbeat timeout expire. After the handler has returned, a heartbeat that finds the callback gone only stops the heartbeats, and `context.signal` is not aborted. A heartbeat still in flight when the job ends is cancelled, so the job ends at once, and its failure is not logged. An attempt can reach the service although its answer never arrives. The retry then gets "already complete", and the worker logs a warning that an earlier attempt probably reported the outcome, instead of an error. This also applies when the AWS SDK retried inside one attempt, whatever its last try failed with, because an earlier try may have reached the service. A credential error on the only try does not count, because it sends no request. A permanent error, such as `AccessDeniedException` or a callback that is already complete on the first attempt, is not retried. Expired credentials, throttling, a signature rejected because of a clock offset, and a credential endpoint that did not answer are retried, because they can clear. So a role that is truly missing costs about 15 seconds of retries before the outcome is dropped.
3. Reports a result that is over 256 KB, or that is not JSON-serializable, as a failure. So the durable function learns why at once, instead of at its timeout.

The interval is a third of the heartbeat timeout, at most 15 minutes. The job's heartbeat timeout must be at least 1 second. An explicit `heartbeatIntervalMs` must be a positive integer of at most 15 minutes, and is cut to a third of the job's heartbeat timeout. Each heartbeat call, including its credential fetch, ends after half the interval. After a failed heartbeat, the next one comes after an eighth to a quarter of the interval, for at most two failures in a row. After that, heartbeats return to the normal schedule, so a run of failures costs at most two extra calls. So up to two failed or stalled calls in a row stay within the heartbeat timeout, including the time of the call that succeeds next, as long as responses arrive promptly and the handler does not block the event loop; the margin in that case is the 1 to 2 second jitter, or half the interval for a heartbeat timeout under 6 seconds. A third one in a row can let the job reach its heartbeat timeout. A heartbeat rejection that a retry is unlikely to fix soon, such as `AccessDeniedException` for a missing `lambda:SendDurableExecutionCallbackHeartbeat` permission, is logged once as an error. Heartbeats then continue, because the rejection can still clear, for example while an IAM change propagates. A rejection counts as a failure for the quick retries, so the two-failure bound above holds for any mix of failures. The same rejection is not logged again until a heartbeat succeeds. Throttling, clock-skew, and expired-credential errors, and errors that the AWS SDK marks as retryable, count as transient, for heartbeats and for completions. An explicit interval under a few seconds suits tests only, because each call gets half the interval.

A session's run hook payload can set `autoSuspendIdleSeconds`. The worker then suspends its own MicroVM when it has run no job for that many seconds:

1. The idle time starts when the `run` hook arrives without a job, when a job ends, and when the `resume` lifecycle hook arrives, if the image enables it.
2. A job that starts cancels the idle time. So the worker never suspends the MicroVM during a job.
3. When the idle time ends, the worker calls `SuspendMicrovm` with the MicroVM ID from the `run` hook, never one from a job request. The call returned in under 100 milliseconds in testing, before the MicroVM froze. The durable function resumes the MicroVM before the next job, and the process continues with its memory and files.
4. From the moment the idle time ends, the worker answers every job with HTTP 503 and does not start it. A job accepted then would freeze with the MicroVM, and nothing would resume it. After a 503, the durable function checks the state, resumes the MicroVM, and delivers the job again.
5. The refusal ends when the `resume` lifecycle hook arrives, or 30 seconds after the call returned, if no hook arrives. The idle time then starts again. So enable the `resume` hook in the image. Without it, the first job after a resume can wait up to 30 seconds.
6. A call that the service rejected on its first attempt, such as `AccessDeniedException` for a missing permission, is logged as a warning, and the MicroVM keeps running. The worker accepts jobs again at once and does not retry the call. The next job that ends starts the idle time again.
7. A call whose outcome is unknown, such as a timeout, a throttle, a conflict, or a server error, is handled like a successful call, because the service may have suspended the MicroVM anyway. A rejection after the client retried an earlier attempt also counts as unknown, because the earlier attempt may have suspended the MicroVM. The refusal continues until the `resume` hook or the 30-second limit. The idle time then starts again, so the worker tries the call again.

`close()` stops the idle time. A closed worker never suspends its MicroVM again. A refusal that is already running still ends on the `resume` hook or after 30 seconds.

The worker counts only jobs. It cannot see background processes, or inbound traffic that is not a job. A session with such work sets `autoSuspendOnIdle: false`, and the payload then has no `autoSuspendIdleSeconds`.

A second delivery of a job is answered like the first and ignored, while the job runs and after it ended. The durable function can deliver the same job again: it retries a delivery whose response it did not receive, and its request step runs again on replay when its result was not checkpointed. The worker remembers the callback IDs of the last 1,000 finished jobs. So a job runs once, unless more than 1,000 other jobs ended in between, or the worker process restarted.

It creates a Lambda client for each job, after the job arrives, not at image build. A client created before the snapshot would share build-time state across every MicroVM, and a client kept across jobs would keep connections that a suspend of the MicroVM can leave dead. So each job's first heartbeat pays for the credential fetch and the connection setup within its call timeout, which is half the interval: a sixth of the heartbeat timeout with the default interval. A heartbeat timeout under about 10 seconds can therefore lose the first heartbeat. The quick retry usually covers it. The worker destroys each job's default client when the job ends, and never destroys a client from `createClient`.

An error in a custom `logger` or in `createClient` never ends the worker process. The worker drops a failed log line, including one from an async logger whose promise rejects, and logs a job whose client it could not create. An error value that cannot be read, such as one whose `message` getter throws, is still reported as a failure. A handler's `abort` listener on `context.signal` must not throw: Node treats that as an uncaught exception.

A document that does not match the contract gets HTTP 400. If the document named a callback, the worker also fails that callback, so the durable function fails at once instead of at its timeout. A result over 256 KB is reported as a failure, because the callback API does not accept it.

## Permissions

The MicroVM execution role needs `lambda:SendDurableExecutionCallbackSuccess`, `lambda:SendDurableExecutionCallbackFailure`, and `lambda:SendDurableExecutionCallbackHeartbeat` on the durable function's ARN (`arn:aws:lambda:<region>:<account>:function:<name>:*`). The worker uses the default credential chain, which resolves that role inside the MicroVM.

A session that suspends when idle also needs `lambda:SuspendMicrovm` on the MicroVM image (`arn:aws:lambda:<region>:<account>:microvm-image:<name>`). The action authorizes on the image, not on the MicroVM. So a MicroVM with this permission can suspend any MicroVM from the same image, even during a job. That job then waits until its heartbeat timeout or its timeout. Use one image per trust boundary.

## Lower-level building blocks

- `createMicrovmWorkerListener(options)` returns a Node.js request listener, so you can serve the hooks and routes from your own HTTP server.
- `parseRunHookRequest(body)` validates a `run` hook body, and `parseJobRequest(body)` validates a job request.
- `CallbackReporter` sends heartbeats and completes one callback. Its `succeed` throws `ResultTooLargeError` (a `RangeError`) for a result over 256 KB and `ResultSerializationError` (a `TypeError`) for a result that is not JSON-serializable, both before any call.
