# AWS Durable Execution SDK Compute Worker

> **Experimental.** Every API in this package is experimental. It may change or be removed in a future release, without a major version bump.

Run job handlers inside an AWS Lambda MicroVM for the [`microvm` and `microvmSession` operations](../aws-durable-execution-sdk-js-extras). The worker receives each job, sends heartbeats while it runs, and reports its result to the durable function.

The package root exports the code that every compute type shares, such as `CallbackReporter`. The MicroVM worker is in the `@aws/durable-execution-sdk-js-compute-worker/microvm` subpath. The AgentCore Runtime worker is in the `@aws/durable-execution-sdk-js-compute-worker/agentcore` subpath. Both subpaths also export the shared code.

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

## Run a job in AgentCore Runtime

> **Experimental.** The `agentcore` subpath is experimental, like `microvm`.

The `@aws/durable-execution-sdk-js-compute-worker/agentcore` subpath runs the jobs of the [`agentcore` operation](../aws-durable-execution-sdk-js-extras#run-a-job-in-agentcore-runtime) inside an Amazon Bedrock AgentCore Runtime agent. It implements the AgentCore HTTP contract itself and adds no dependency.

The durable function:

```typescript
import { agentcore } from "@aws/durable-execution-sdk-js-extras/compute/agentcore";

const review = await agentcore<{ approved: boolean }>(context, "review", { pr: 7 }, {
  agentRuntimeArn: process.env.AGENT_RUNTIME_ARN!,
  timeout: { hours: 1 },
  heartbeatTimeout: { minutes: 5 },
});
```

The agent's container entry point:

```typescript
import { startAgentcoreWorker } from "@aws/durable-execution-sdk-js-compute-worker/agentcore";

await startAgentcoreWorker<{ pr: number }, { approved: boolean }>({
  handler: async (input, context) => {
    context.logger.info("reviewing", { pr: input.pr });
    return { approved: true };
  },
});
```

The worker listens on port 8080. AgentCore Runtime requires the agent to listen on `0.0.0.0:8080`, and it sets the `AGENTCORE_RUNTIME_URL` environment variable, also for a direct code deployment. So the worker binds `0.0.0.0` when that variable is set, and `127.0.0.1` otherwise. `/invocations` has no authentication of its own, so a local run stays on loopback. Pass a `host` as the third argument of `startAgentcoreWorker` to choose another address.

- `GET /ping` answers `{"status": "HealthyBusy"}` while a job runs, and `{"status": "Healthy"}` otherwise. The answer also has `time_of_last_update`: the Unix time, in seconds, of the last status change. The worker sets it when it starts and when the status changes, not on every ping.
- `POST /invocations` answers `{"accepted": true}` and then starts the handler on a later turn of the event loop. So synchronous work at the start of the handler cannot delay the answer. A repeated callback ID gets the same answer and does not run again. A document that does not match the contract gets HTTP 400.

The worker remembers the last 1,000 callback IDs in memory. So a retried delivery runs a job once, unless at least 1,000 other jobs arrived in between, or the worker process restarted. A retry can reach a new process, for example after the agent runtime's idle timeout replaced the old one. The new process does not know the callback ID, so it runs the job again. So delivery is at least once, and the handler's side effects must be idempotent.

The handler's context has `sessionId`: the AgentCore runtime session ID from the `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` request header. It is `undefined` when the request has no such header. The worker's log lines for a job carry it as `runtimeSessionId`, next to `callbackId`.

The worker drops an error that a logger method throws, and a rejection of a promise that it returns. So a failing logger cannot end the worker process.

The worker sends heartbeats while the job runs, when the job has a `heartbeatTimeout`. It then completes the callback with the handler's result or error.

The handler runs on the event loop that also answers `/ping` and sends heartbeats. Synchronous CPU work blocks both while it runs. So run CPU-bound work in a worker thread or a child process.

After the agent runtime's idle timeout (`idleRuntimeSessionTimeout`), the same session ID silently gets a new microVM, and the memory and files of the old one are lost. The `agentcore` operation sends one job per session. So a new microVM cannot receive a later job of the same operation. The idle timeout matters only while the job runs, and the worker then reports `HealthyBusy`, which keeps the session alive.

Permissions:

- The function's execution role needs `bedrock-agentcore:InvokeAgentRuntime` and `bedrock-agentcore:StopRuntimeSession` on both the agent runtime ARN and `<runtime ARN>/runtime-endpoint/*`. Without the endpoint resource, the service denies the call on `<runtime ARN>/runtime-endpoint/DEFAULT`.
- The agent runtime's execution role needs `lambda:SendDurableExecutionCallbackSuccess`, `lambda:SendDurableExecutionCallbackFailure`, and `lambda:SendDurableExecutionCallbackHeartbeat` on the function ARN (`arn:aws:lambda:<region>:<account>:function:<name>:*`).

## Reference

- [MicroVM worker reference](docs/worker.md): hook handling, heartbeats, result reporting, duplicate jobs, idle suspend, suspend and terminate hooks, and best practices.
- [MicroVM operations reference](../aws-durable-execution-sdk-js-extras/docs/microvm.md): the contract between the operations and the worker.
- Lower-level exports: `parseRunHookRequest`, `parseJobRequest`, and `CallbackReporter`.
- Source: [`src/microvm/worker.ts`](src/microvm/worker.ts), [`src/callback-reporter.ts`](src/callback-reporter.ts), and [`src/microvm/payload.ts`](src/microvm/payload.ts).
- AgentCore worker source: [`src/agentcore/worker.ts`](src/agentcore/worker.ts).
