# AWS Durable Execution SDK Compute Worker

> **Experimental.** Every API in this package is experimental. It may change or be removed in a future release, without a major version bump.

Run job handlers inside an AWS Lambda MicroVM for the [`microvm` and `microvmSession` operations](../aws-durable-execution-sdk-js-extras). The worker receives each job, sends heartbeats while it runs, and reports its result to the durable function.

The package root exports the code that every compute type shares, such as `CallbackReporter`. The MicroVM worker is in the `@aws/durable-execution-sdk-js-compute-worker/microvm` subpath. That subpath also exports the shared code.

## Install

```bash
npm install @aws/durable-execution-sdk-js-compute-worker
```

## Quick start

```typescript
import { startMicrovmWorker } from "@aws/durable-execution-sdk-js-compute-worker/microvm";

await startMicrovmWorker<{ repo: string }, { passed: boolean }>({
  handler: async (input, context) => {
    const passed = await runBuild(input.repo, { signal: context.signal });
    return { passed };
  },
});
```

Start the worker when the image's process starts. Lambda snapshots the process after the `ready` hook. So the worker must already listen at that point. The worker listens on port 8080 by default.

- The handler's resolved value becomes the result of `microvm(...)` or `vm.invoke(...)` in the durable function.
- A rejection fails that call with a `MicrovmJobFailedError`. The worker sends the error's name and message, not its stack.
- `context.signal` aborts when the durable function stops waiting, or when Lambda terminates the MicroVM. The handler should then stop its work.

## Image configuration

Enable these hooks in `CreateMicrovmImage`:

```json
{
  "hooks": {
    "port": 8080,
    "microvmHooks": {
      "run": "ENABLED",
      "runTimeoutInSeconds": 10,
      "resume": "ENABLED",
      "resumeTimeoutInSeconds": 10,
      "suspend": "ENABLED",
      "suspendTimeoutInSeconds": 10,
      "terminate": "ENABLED",
      "terminateTimeoutInSeconds": 10
    },
    "microvmImageHooks": { "ready": "ENABLED" }
  }
}
```

- `run` is required. It delivers small jobs, and tells the worker that other jobs arrive over HTTP.
- `ready` is required whenever a lifecycle hook is enabled.
- `resume` and `suspend` are recommended for sessions that suspend. Without `resume`, the first job after a suspend can wait up to 30 seconds.
- `terminate` is recommended. With it, a running job fails at once when the MicroVM ends, instead of at its heartbeat timeout. Give it at least 10 seconds.
- `port` must match the worker's port.

## Common uses

### Serve named routes

A job sent with `request: { path: "/build" }` in `microvm`, or `path: "/build"` in `vm.invoke`, goes to the route with that path:

```typescript
await startMicrovmWorker({
  handler: async (input) => defaultJob(input),
  routes: {
    "/build": async (input, context) => build(input, context.signal),
    "/test": async (input, context) => test(input, context.signal),
  },
});
```

The worker needs `handler`, `routes`, or both. A route path must start with `/`, must not start with `/aws/lambda-microvms/runtime/v1/`, and must not be `/durable-execution/v1/job`.

### Read job details

`context` holds `callbackId`, `microvmId`, `region`, `signal`, and `logger`:

```typescript
await startMicrovmWorker({
  handler: async (input, context) => {
    context.logger.info("job started", { microvmId: context.microvmId });
    return run(input, context.signal);
  },
});
```

### Use your own HTTP server

`createMicrovmWorkerListener(options)` returns a Node.js request listener. Use it to serve the hooks and job routes from your own server:

```typescript
import { createServer } from "node:http";
import { createMicrovmWorkerListener } from "@aws/durable-execution-sdk-js-compute-worker/microvm";

const { listener } = createMicrovmWorkerListener({ handler: runJob });
createServer(listener).listen(8080);
```

## Advanced

### Job handler rules

1. Return a JSON-serializable value of at most 256 KB. Otherwise the worker reports a failure, although the work succeeded. Store a larger result elsewhere, for example in S3, and return a reference.
2. Throw `Error` instances. The worker reports the error's `name` as the error type. A thrown value that is not an `Error` reports the type `Error`.
3. Make side effects safe to repeat. The worker runs a job once per callback ID, but the durable function can send the same work again as a new job.

### Options

- `logger`: receives the worker's info, warning, and error logs. It must not throw.
- `createClient(region)`: returns the `LambdaClient` for callback calls. By default the worker creates one client per job, after the job arrives.
- `createMicrovmsClient(region)`: returns the `LambdaMicrovmsClient` for the idle `SuspendMicrovm` call. Set `maxAttempts: 1` on it, because a retried suspend can freeze the next job.
- `heartbeatIntervalMs`: overrides the heartbeat interval. By default the worker sends a heartbeat about every third of the job's heartbeat timeout.

`startMicrovmWorker(options, port)` returns `{ port, idle, close }`. `idle()` resolves when every started job has ended. `close()` stops the server.

### Suspend when idle

A session with `autoSuspendOnIdle: true` makes the worker suspend its own MicroVM after the idle time without a job. The worker never suspends during a job. The SDK never calls `ResumeMicrovm`. The service resumes the MicroVM on the next job request only when the session sets `idlePolicy.autoResumeEnabled`. See [Suspend a MicroVM between jobs](../aws-durable-execution-sdk-js-extras#suspend-a-microvm-between-jobs).

### Permissions

The MicroVM execution role needs `lambda:SendDurableExecutionCallbackSuccess`, `lambda:SendDurableExecutionCallbackFailure`, and `lambda:SendDurableExecutionCallbackHeartbeat` on the durable function's ARN (`arn:aws:lambda:<region>:<account>:function:<name>:*`).

A session with `autoSuspendOnIdle: true` also needs `lambda:SuspendMicrovm` on the MicroVM image. That permission lets any MicroVM of the image suspend any other. So use one image per trust boundary.

## Reference

- [MicroVM worker reference](docs/worker.md): hook handling, heartbeats, result reporting, duplicate jobs, idle suspend, suspend and terminate hooks, and best practices.
- [MicroVM operations reference](../aws-durable-execution-sdk-js-extras/docs/microvm.md): the contract between the operations and the worker.
- Lower-level exports: `parseRunHookRequest`, `parseJobRequest`, and `CallbackReporter`.
- Source: [`src/microvm/worker.ts`](src/microvm/worker.ts), [`src/callback-reporter.ts`](src/callback-reporter.ts), and [`src/microvm/payload.ts`](src/microvm/payload.ts).
