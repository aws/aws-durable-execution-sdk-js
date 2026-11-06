// The durable function that the end-to-end test deploys. Each event selects
// one scenario, so one deployment covers every case.
import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  type MicrovmConfig,
  microvm,
  microvmSession,
} from "@aws/durable-execution-sdk-js-extras/compute/microvm";
import {
  GetMicrovmCommand,
  LambdaMicrovmsClient,
  TerminateMicrovmCommand,
} from "@aws-sdk/client-lambda-microvms";

export interface E2eJob {
  /** What the job in the MicroVM does. See microvm-app.ts. */
  mode: "succeed" | "fail" | "crash";
  sleepSeconds: number;
  label: string;
}

export interface E2eEvent {
  scenario:
    | "single"
    | "parallel"
    | "session"
    | "idle-session"
    | "suspend-session"
    | "suspend-after-session";
  job: E2eJob;
  timeoutSeconds: number;
  heartbeatTimeoutSeconds?: number;
  /** The first wait between the jobs of the suspend-session scenario. */
  pauseSeconds?: number;
  /** The session's autoSuspendIdleTime, for the suspend-session scenario. */
  autoSuspendIdleSeconds?: number;
  /** Delivers the job over HTTP to this route instead of the run hook. */
  requestPath?: string;
  /** Adds this many characters of padding to the input. */
  paddingLength?: number;
  /** The padding character. The default is "x". */
  paddingChar?: string;
  /**
   * Terminates the MicroVM as soon as RunMicrovm returns, and waits until
   * GetMicrovm reports TERMINATED. So the job finds a dead MicroVM.
   */
  terminateAfterLaunch?: boolean;
  /** Logs each job request of a session, so the runner can count them. */
  logRequests?: boolean;
  /** The session idle policy. */
  idlePolicy?: {
    autoResumeEnabled: boolean;
    maxIdleDurationSeconds: number;
    suspendedDurationSeconds: number;
  };
}

export const handler = withDurableExecution(
  async (event: E2eEvent, context: DurableContext) => {
    const config: MicrovmConfig = {
      imageIdentifier: requireEnv("MICROVM_IMAGE_ARN"),
      executionRoleArn: requireEnv("MICROVM_ROLE_ARN"),
      timeout: { seconds: event.timeoutSeconds },
      ...(event.heartbeatTimeoutSeconds !== undefined && {
        heartbeatTimeout: { seconds: event.heartbeatTimeoutSeconds },
      }),
      ...(event.requestPath !== undefined && {
        request: { path: event.requestPath },
      }),
      ...(event.terminateAfterLaunch === true && {
        client: terminatingClient(),
        fetch: loggingFetch(context.executionContext.durableExecutionArn),
      }),
    };
    const job = event.paddingLength
      ? {
          ...event.job,
          padding: (event.paddingChar ?? "x").repeat(event.paddingLength),
        }
      : event.job;

    if (event.scenario === "idle-session") {
      // One long job in a session with a short idle policy. The job receives
      // no inbound traffic after its request. It sends only outbound
      // heartbeats. The outcome shows whether outbound traffic keeps the
      // MicroVM from being suspended.
      return microvmSession(
        context,
        "idle",
        {
          imageIdentifier: config.imageIdentifier,
          executionRoleArn: config.executionRoleArn,
          timeout: config.timeout,
          idlePolicy: event.idlePolicy,
        },
        async (vm, ctx) =>
          vm.invoke(ctx, "long", event.job, {
            path: "/job",
            timeout: config.timeout,
            heartbeatTimeout: config.heartbeatTimeout,
          }),
      );
    }

    if (event.scenario === "suspend-after-session") {
      // The first job stores a value in the worker's memory, and the durable
      // function suspends the MicroVM after it. The second job is sent at
      // once, inside the window of about 5 seconds in which the endpoint
      // answers 502 and does not resume the MicroVM. The service then
      // resumes it on a retry. The function role has no
      // lambda:ResumeMicrovm, so a ResumeMicrovm call would fail the job.
      return microvmSession(
        context,
        "suspend-after",
        {
          imageIdentifier: config.imageIdentifier,
          executionRoleArn: config.executionRoleArn,
          timeout: config.timeout,
          idlePolicy: event.idlePolicy,
          ...(event.logRequests === true && {
            fetch: loggingFetch(context.executionContext.durableExecutionArn),
          }),
        },
        async (vm, sessionContext) => {
          const remembered = await vm.invoke<{ pid: number }>(
            sessionContext,
            "remember",
            { value: event.job.label },
            { path: "/remember", timeout: { minutes: 5 }, suspendAfter: true },
          );
          const recalled = await vm.invoke<{ pid: number; value: string }>(
            sessionContext,
            "recall",
            {},
            {
              path: "/recall",
              timeout: { minutes: 5 },
              heartbeatTimeout: { seconds: 90 },
            },
          );
          return { remembered, recalled, sessionMicrovmId: vm.microvmId };
        },
      );
    }

    if (event.scenario === "suspend-session") {
      // The first job stores a value in the worker's memory. The worker
      // suspends its MicroVM when it has run no job for the idle time, during
      // the first wait. The second wait finds the MicroVM still suspended.
      // The service resumes the MicroVM on the last job's request, and the
      // job reads the value back from memory.
      return microvmSession(
        context,
        "suspending",
        {
          imageIdentifier: config.imageIdentifier,
          executionRoleArn: config.executionRoleArn,
          timeout: config.timeout,
          idlePolicy: event.idlePolicy,
          autoSuspendOnIdle: true,
          ...(event.autoSuspendIdleSeconds !== undefined && {
            autoSuspendIdleTime: { seconds: event.autoSuspendIdleSeconds },
          }),
        },
        async (vm, sessionContext) => {
          const remembered = await vm.invoke<{ pid: number }>(
            sessionContext,
            "remember",
            { value: event.job.label },
            { path: "/remember", timeout: { minutes: 5 } },
          );
          await sessionContext.wait("long-pause", {
            seconds: event.pauseSeconds ?? 60,
          });
          await sessionContext.wait("second-pause", { seconds: 20 });
          const recalled = await vm.invoke<{ pid: number; value: string }>(
            sessionContext,
            "recall",
            {},
            { path: "/recall", timeout: { minutes: 5 } },
          );
          return { remembered, recalled, sessionMicrovmId: vm.microvmId };
        },
      );
    }

    if (event.scenario === "session") {
      // The second job reads a file that the first job wrote. A durable wait
      // between them ends the invocation, and the MicroVM keeps running.
      return microvmSession(
        context,
        "pipeline",
        {
          imageIdentifier: config.imageIdentifier,
          executionRoleArn: config.executionRoleArn,
          timeout: config.timeout,
        },
        async (vm, sessionContext) => {
          const key = event.job.label;
          const written = await vm.invoke<{ microvmId: string }>(
            sessionContext,
            "write",
            { key, value: `written-by-${key}` },
            { path: "/write", timeout: { minutes: 5 } },
          );
          await sessionContext.wait("pause", { seconds: 5 });
          const read = await vm.invoke<{ microvmId: string; value: string }>(
            sessionContext,
            "read",
            { key },
            { path: "/read", timeout: { minutes: 5 } },
          );
          return { written, read, sessionMicrovmId: vm.microvmId };
        },
      );
    }

    if (event.scenario === "parallel") {
      // Each map item is a child context. The operation takes the item's
      // context, so each job runs inside its item.
      const batch = await context.map(
        "jobs",
        ["a", "b"],
        async (itemContext, label) =>
          microvm(itemContext, `job-${label}`, { ...job, label }, config),
      );
      batch.throwIfError();
      return batch.getResults();
    }

    return microvm(context, "job", job, config);
  },
);

/**
 * Returns a client that terminates each MicroVM that RunMicrovm returns, and
 * waits up to 60 seconds for TERMINATED. The launch step then records a dead
 * MicroVM, as when a MicroVM fails right after its launch.
 */
function terminatingClient(): LambdaMicrovmsClient {
  const client = new LambdaMicrovmsClient({});
  const other = new LambdaMicrovmsClient({});
  client.middlewareStack.add(
    (next, middlewareContext) => async (args) => {
      const output = await next(args);
      const microvmId = (output.output as { microvmId?: string }).microvmId;
      if (middlewareContext.commandName === "RunMicrovmCommand" && microvmId) {
        await other.send(
          new TerminateMicrovmCommand({ microvmIdentifier: microvmId }),
        );
        for (let i = 0; i < 30; i++) {
          const vm = await other.send(
            new GetMicrovmCommand({ microvmIdentifier: microvmId }),
          );
          if (vm.state === "TERMINATED") {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
        console.log(JSON.stringify({ e2e: "terminated", microvmId }));
      }
      return output;
    },
    { step: "initialize", name: "e2eTerminateAfterLaunch" },
  );
  return client;
}

/**
 * Returns the global fetch with one log line per request: the status, the
 * proxy error header, and the time. The end-to-end runner counts the lines.
 */
function loggingFetch(executionArn: string): typeof fetch {
  return async (input, init) => {
    const started = Date.now();
    const base = { e2e: "fetch", execution: executionArn.split("/").at(-2) };
    try {
      const response = await fetch(input, init);
      console.log(
        JSON.stringify({
          ...base,
          status: response.status,
          proxyError: response.headers.get("x-aws-proxy-error"),
          ms: Date.now() - started,
        }),
      );
      return response;
    } catch (error) {
      console.log(
        JSON.stringify({
          ...base,
          error: (error as Error).name,
          ms: Date.now() - started,
        }),
      );
      throw error;
    }
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}
