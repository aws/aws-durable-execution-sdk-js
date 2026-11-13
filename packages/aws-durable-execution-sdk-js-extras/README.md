# AWS Durable Execution SDK Extras

> **Experimental.** Every API in this package is experimental. It may change or be removed in a future release, without a major version bump.

Ready-made durable operations for the [AWS Durable Execution SDK](../aws-durable-execution-sdk-js). The first operations run jobs in [AWS Lambda MicroVMs](https://docs.aws.amazon.com/lambda/latest/dg/lambda-microvms-guide.html).

## Install

```bash
npm install @aws/durable-execution-sdk-js @aws/durable-execution-sdk-js-extras @aws-sdk/client-lambda-microvms
```

`@aws-sdk/client-lambda-microvms` is an optional peer dependency. So npm does not install it for you. The `compute/microvm` subpath needs it. The package needs `@aws/durable-execution-sdk-js` 2.6.0 or later.

## Quick start

`microvm` launches a MicroVM, sends it one job, waits for the result, and terminates the MicroVM:

```typescript
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { microvm } from "@aws/durable-execution-sdk-js-extras/compute/microvm";

export const handler = withDurableExecution(
  async (event: { repo: string; commit: string }, context) => {
    const build = await microvm<{ passed: boolean }>(
      context,
      "build",
      { repo: event.repo, commit: event.commit },
      {
        imageIdentifier: process.env.MICROVM_IMAGE_ARN!,
        executionRoleArn: process.env.MICROVM_ROLE_ARN!,
        timeout: { hours: 1 },
        heartbeatTimeout: { minutes: 5 },
      },
    );
    return build.passed;
  },
);
```

The function invocation ends while the MicroVM works. So Lambda does not bill function compute during the wait.

The code in the MicroVM runs [`@aws/durable-execution-sdk-js-compute-worker`](../aws-durable-execution-sdk-js-compute-worker). The worker runs your job handler and reports its result.

## Common uses

### Run several jobs on one MicroVM

`microvmSession` launches one MicroVM and calls your handler. The handler sends jobs with `vm.invoke`. The jobs share the MicroVM's files and processes. The session terminates the MicroVM when the handler returns or throws.

```typescript
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { microvmSession } from "@aws/durable-execution-sdk-js-extras/compute/microvm";

export const handler = withDurableExecution(
  async (event: { repo: string }, context) =>
    microvmSession(
      context,
      "pipeline",
      {
        imageIdentifier: process.env.MICROVM_IMAGE_ARN!,
        executionRoleArn: process.env.MICROVM_ROLE_ARN!,
        timeout: { hours: 2 }, // lifetime of the MicroVM, at most 8 hours
      },
      async (vm, ctx) => {
        const build = await vm.invoke(ctx, "build", { repo: event.repo }, {
          timeout: { minutes: 15 },
          heartbeatTimeout: { seconds: 30 },
        });
        await ctx.wait({ minutes: 10 });
        const tests = await vm.invoke(ctx, "test", { build }, {
          timeout: { minutes: 10 },
          heartbeatTimeout: { seconds: 30 },
        });
        return { build, tests };
      },
    ),
);
```

- Pass `vm.invoke` the context it runs in: the handler's `ctx`, or a nested context such as a `map` item's context. A durable operation created in a parent context from inside a child context fails the execution.
- Set a `heartbeatTimeout` on every job. Otherwise a job on a MicroVM that ended waits for its full `timeout`.
- The session's return value is checkpointed. So it must be JSON-serializable.

### Send a job to a named route

By default a job goes to the worker's `handler`. To send it to a route, set the path:

```typescript
await microvm(context, "build", input, { ...config, request: { path: "/build" } });
await vm.invoke(ctx, "build", input, { path: "/build", timeout: { minutes: 15 } });
```

The worker serves the route with `routes: { "/build": handler }`.

### Run jobs in parallel

Call `microvm` inside `map`, and pass each item its own context:

```typescript
const results = await context.map("builds", commits, async (itemCtx, commit) =>
  microvm(itemCtx, `build-${commit}`, { commit }, config),
);
```

### Handle errors

Every MicroVM failure is a `MicrovmError`. A subclass names the kind of failure:

```typescript
import {
  MicrovmError,
  MicrovmJobFailedError,
  MicrovmTimeoutError,
  microvm,
} from "@aws/durable-execution-sdk-js-extras/compute/microvm";

try {
  await microvm(context, "build", input, config);
} catch (error) {
  if (error instanceof MicrovmJobFailedError) {
    // The job handler in the MicroVM threw.
  } else if (error instanceof MicrovmTimeoutError) {
    // No result within timeout, or no heartbeat within heartbeatTimeout.
  } else if (error instanceof MicrovmError) {
    // Launch or delivery failed.
  }
}
```

The other subclasses are `MicrovmLaunchError`, `MicrovmDeliveryError`, and `MicrovmNotRunningError`. `MicrovmError` extends `ComputeError`, which the package root exports. The class is the same on replay. So code that branches on it stays deterministic.

## Advanced

### Permissions

The function's execution role needs:

- `lambda:RunMicrovm` and `lambda:TerminateMicrovm`.
- `lambda:CreateMicrovmAuthToken` and `lambda:GetMicrovm`, for jobs over HTTP. Every session job goes over HTTP. A `microvm` job goes over HTTP when it is too large for the `run` hook or sets `request.path`.
- `lambda:PassNetworkConnector` on the network connectors. With the defaults, that is `arn:aws:lambda:<region>:aws:network-connector:aws-network-connector:*`.
- `iam:PassRole` on the MicroVM execution role.
- `lambda:SuspendMicrovm` on the MicroVM image, only for jobs with `suspendAfter`.

Without `lambda:TerminateMicrovm`, each MicroVM runs, and is billed, until its maximum duration. The only sign is an error in the function's log.

The MicroVM execution role (`executionRoleArn`) needs `lambda:SendDurableExecutionCallbackSuccess`, `lambda:SendDurableExecutionCallbackFailure`, and `lambda:SendDurableExecutionCallbackHeartbeat` on the function ARN (`arn:aws:lambda:<region>:<account>:function:<name>:*`).

### Function timeout and versions

- A job over HTTP needs at least 11 seconds left in the invocation when its request step starts. Every session job goes over HTTP. So the default Lambda timeout of 3 seconds fails every session job. A function timeout of 71 seconds gives the request step its whole 60-second retry window.
- Invoke the durable function through a published version or an alias, not `$LATEST`. Lambda then runs every replay on the same code.

### Retries

The AWS SDK client and the request step retry short failures inside one invocation. When those retries give up, the step retry strategy retries in a later invocation. The default strategy, `defaultMicrovmRetryStrategy`, allows 5 attempts. `retryStrategy` in the config replaces it. A strategy that does not retry throttling fails the terminate step on throttling. The MicroVM then runs until its maximum duration.

### Suspend a MicroVM between jobs

A suspended MicroVM keeps its memory and files and pays only for snapshot storage. A session can suspend its MicroVM in two ways:

- `autoSuspendOnIdle: true` on the session: the worker suspends its own MicroVM after `autoSuspendIdleTime` (default 60 seconds) without a job.
- `suspendAfter: true` on one `vm.invoke`: the durable function suspends the MicroVM after that job.

The SDK never calls `ResumeMicrovm`. The service resumes a suspended MicroVM on the next request only when the MicroVM has `idlePolicy.autoResumeEnabled` set. You set it in the session config. The SDK does not set it. Without it, the next job after a suspend fails with `MicrovmDeliveryError`. `RunMicrovm` requires all three fields of `idlePolicy`.

```typescript
await microvmSession(
  context,
  "pipeline",
  {
    ...config,
    idlePolicy: {
      autoResumeEnabled: true,
      maxIdleDurationSeconds: 86_400, // above maximumDurationInSeconds
      suspendedDurationSeconds: 28_800, // the session timeout or more
    },
  },
  async (vm, ctx) => {
    const build = await vm.invoke(ctx, "build", input, {
      timeout: { minutes: 15 },
      suspendAfter: true,
    });
    await ctx.waitForCallback("approval", sendApprovalRequest);
    return vm.invoke(ctx, "deploy", build, {
      timeout: { minutes: 10 },
      heartbeatTimeout: { seconds: 120 },
    });
  },
);
```

1. `maximumDurationInSeconds` of a MicroVM is the operation `timeout` plus 5 minutes, at most 8 hours. The idle timer counts only inbound requests. A job receives no inbound requests while it runs. So set `maxIdleDurationSeconds` above `maximumDurationInSeconds`. A lower value lets the service suspend a running job.
2. The SDK does not guard `suspendAfter`. Parallel operations on the same session are your responsibility. A job that runs next to a `suspendAfter` job, for example in `map`, `parallel`, or `ctx.promise.all`, freezes with the MicroVM.
3. Use `suspendAfter` only on the job before a long wait. Give the next job a `heartbeatTimeout` of at least its `retryWindow` plus 30 seconds.
4. Enable the `resume` hook in the image. Without it, the worker refuses the next job for up to 30 seconds.

### Limits

- `timeout` is between 1 second and 8 hours.
- A job input is at most `MAX_JOB_INPUT_BYTES` (6,283,264 bytes) as UTF-8 JSON. Pass larger data by reference, for example as an S3 key.
- A job result is at most 256 KB as JSON.

## Run a job in AgentCore Runtime

> **Experimental.** The `compute/agentcore` subpath is experimental, like `compute/microvm`.

`agentcore` sends one job to a new session of an [Amazon Bedrock AgentCore Runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html) agent, waits for the result, and stops the session. You deploy the agent runtime outside the function. The subpath needs the optional peer dependency `@aws-sdk/client-bedrock-agentcore`:

```bash
npm install @aws-sdk/client-bedrock-agentcore
```

The durable function:

```typescript
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { agentcore } from "@aws/durable-execution-sdk-js-extras/compute/agentcore";

export const handler = withDurableExecution(
  async (event: { pr: number }, context) => {
    const review = await agentcore<{ approved: boolean }>(
      context,
      "review",
      { pr: event.pr },
      {
        agentRuntimeArn: process.env.AGENT_RUNTIME_ARN!,
        qualifier: "DEFAULT",
        timeout: { hours: 1 },
        heartbeatTimeout: { minutes: 5 },
      },
    );
    return review.approved;
  },
);
```

The code in the agent runtime runs the [compute worker](../aws-durable-execution-sdk-js-compute-worker#run-a-job-in-agentcore-runtime):

```typescript
import { startAgentcoreWorker } from "@aws/durable-execution-sdk-js-compute-worker/agentcore";

await startAgentcoreWorker<{ pr: number }, { approved: boolean }>({
  handler: async (input, context) => {
    context.logger.info("reviewing", { pr: input.pr });
    return { approved: true };
  },
});
```

The operation creates the steps `<name>.session` (the runtime session ID), `<name>.request` (InvokeAgentRuntime), and `<name>.stop` (StopRuntimeSession), and the callback `<name>.callback`. The function invocation ends while the agent works. A failure is an `AgentcoreError`: `AgentcoreDeliveryError`, `AgentcoreJobFailedError`, or `AgentcoreTimeoutError`. `AgentcoreError` extends `ComputeError`.

After the agent runtime's idle timeout (`idleRuntimeSessionTimeout`), the same session ID silently gets a new microVM, and the memory and files of the old one are lost. This operation sends one job per session. So a new microVM cannot receive a later job of the same operation. The idle timeout matters only while the job runs, and the worker then reports `HealthyBusy`, which keeps the session alive.

InvokeAgentRuntime and StopRuntimeSession each stop 10 seconds before the Lambda invocation times out, and the step retries in a later invocation.

InvokeAgentRuntime has no idempotency token. So a retried request step can deliver the same job again. The worker remembers the callback IDs of its process and does not run a repeated one. A new process does not know them.

`maxLifetime` is at most 8 hours for a microVM runtime, and up to 14 days for a runtime on Instances. The operation cannot read it, so it checks only that `timeout` is at least 1 second.

An example is in [`src/examples/agentcore/run-job`](../aws-durable-execution-sdk-js-examples/src/examples/agentcore/run-job/agentcore-run-job.ts).

Permissions:

- The function's execution role needs `bedrock-agentcore:InvokeAgentRuntime` and `bedrock-agentcore:StopRuntimeSession` on both the agent runtime ARN and `<runtime ARN>/runtime-endpoint/*`. Without the endpoint resource, the service denies the call on `<runtime ARN>/runtime-endpoint/DEFAULT`.
- The agent runtime's execution role needs `lambda:SendDurableExecutionCallbackSuccess`, `lambda:SendDurableExecutionCallbackFailure`, and `lambda:SendDurableExecutionCallbackHeartbeat` on the function ARN (`arn:aws:lambda:<region>:<account>:function:<name>:*`).

### Rules for AgentCore jobs

- Set `heartbeatTimeout` to at least 1 second. It ends the job when the worker crashes or stops reporting.
- `timeout` must fit the agent runtime's configured `maxLifetime`.
- A job can run more than once when AgentCore replaces the worker process. Make handler side effects safe to repeat.
- Your logger must not throw.
- The runtime's idle timeout applies only while no job is running. One `agentcore()` call runs one job, so it does not lose state between jobs.

## Reference

- [MicroVM operations reference](docs/microvm.md): delivery, the operation tree, subtypes, retries, the error tree, limits, permissions, suspend details, the worker contract, and best practices.
- [End-to-end test](docs/e2e.md)
- [Compute worker](../aws-durable-execution-sdk-js-compute-worker)
- Examples: [one job](../aws-durable-execution-sdk-js-examples/src/examples/microvm/run-job/microvm-run-job.ts) and [a session](../aws-durable-execution-sdk-js-examples/src/examples/microvm/session/microvm-session.ts).
- Source: [`src/compute/microvm`](src/compute/microvm), with option docs in [`types.ts`](src/compute/microvm/types.ts).
- AgentCore source: [`src/compute/agentcore`](src/compute/agentcore), with option docs in [`types.ts`](src/compute/agentcore/types.ts).
- [Lambda MicroVMs guide](https://docs.aws.amazon.com/lambda/latest/dg/lambda-microvms-guide.html)
