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
} from "@aws/durable-execution-sdk-js-helpers/microvm";

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
    | "suspend-session";
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
  /** The session idle policy, for the idle-session scenario. */
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
    };
    const job = event.paddingLength
      ? { ...event.job, padding: "x".repeat(event.paddingLength) }
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
        async (vm) =>
          vm.invoke("long", event.job, {
            path: "/job",
            timeout: config.timeout,
            heartbeatTimeout: config.heartbeatTimeout,
          }),
      );
    }

    if (event.scenario === "suspend-session") {
      // The first job stores a value in the worker's memory. The worker
      // suspends its MicroVM when it has run no job for the idle time, during
      // the first wait. The second wait finds the MicroVM still suspended.
      // The last job resumes the MicroVM and reads the value back from memory.
      return microvmSession(
        context,
        "suspending",
        {
          imageIdentifier: config.imageIdentifier,
          executionRoleArn: config.executionRoleArn,
          timeout: config.timeout,
          ...(event.autoSuspendIdleSeconds !== undefined && {
            autoSuspendIdleTime: { seconds: event.autoSuspendIdleSeconds },
          }),
        },
        async (vm, sessionContext) => {
          const remembered = await vm.invoke<{ pid: number }>(
            "remember",
            { value: event.job.label },
            { path: "/remember", timeout: { minutes: 5 } },
          );
          await sessionContext.wait("long-pause", {
            seconds: event.pauseSeconds ?? 60,
          });
          await sessionContext.wait("second-pause", { seconds: 20 });
          const recalled = await vm.invoke<{ pid: number; value: string }>(
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
            "write",
            { key, value: `written-by-${key}` },
            { path: "/write", timeout: { minutes: 5 } },
          );
          await sessionContext.wait("pause", { seconds: 5 });
          const read = await vm.invoke<{ microvmId: string; value: string }>(
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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}
