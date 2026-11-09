import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { microvmSession } from "@aws/durable-execution-sdk-js-extras/compute/microvm";
import { ExampleConfig } from "../../../types";
import { requireMicrovmEnv } from "../../shared/microvm-env";

export const config: ExampleConfig = {
  name: "MicroVM Session Suspend After",
  description:
    "Runs two jobs in one Lambda MicroVM that the function suspends after the first",
  durableConfig: {
    ExecutionTimeout: 900,
    RetentionPeriodInDays: 7,
  },
  usesMicrovm: true,
};

// The callback named gate holds the second job until the caller completes it.
// If the caller never completes it, the callback times out after 5 minutes.
// The handler then throws, and the session terminates the MicroVM. So a
// failed caller leaves the MicroVM suspended for 5 minutes, not for the whole
// execution timeout.
const GATE_TIMEOUT = { minutes: 5 };

// The second job's request resumes the MicroVM. The request step retries for
// up to 60 seconds while the MicroVM resumes. So the heartbeat timeout of the
// second job is longer than that.
const RESUMED_JOB_HEARTBEAT_TIMEOUT = { seconds: 120 };

export const handler = withDurableExecution(
  async (event: { key: string }, context: DurableContext) => {
    const { imageArn, executionRoleArn } = requireMicrovmEnv();

    // The session launches one MicroVM and terminates it when the handler
    // returns. It does not suspend when idle.
    return microvmSession(
      context,
      "suspend-after-session",
      {
        imageIdentifier: imageArn,
        executionRoleArn,
        timeout: { minutes: 10 },
        // The SDK does not resume a MicroVM. The service resumes it on the
        // next request, when the idle policy enables auto-resume. The idle
        // timer counts only inbound requests. So it is longer than the
        // MicroVM's maximum duration, the timeout plus 5 minutes, and never
        // suspends a running job.
        idlePolicy: {
          autoResumeEnabled: true,
          maxIdleDurationSeconds: 3_600,
          suspendedDurationSeconds: 600,
        },
      },
      async (vm, sessionContext) => {
        // The durable function suspends the MicroVM after this job's result
        // arrives. The function's role needs lambda:SuspendMicrovm on the
        // MicroVM image.
        const written = await vm.invoke<{ microvmId: string }>(
          sessionContext,
          "write",
          { key: event.key, value: `written-by-${event.key}` },
          {
            path: "/write",
            timeout: { minutes: 5 },
            // A job that the MicroVM stops answering fails after this time,
            // instead of after the timeout.
            heartbeatTimeout: { seconds: 30 },
            suspendAfter: true,
          },
        );

        // 1. The first job has ended before the gate starts.
        // 2. The second job starts only after the caller completes the gate.
        // 3. So no job runs while the gate is pending.
        // 4. So the function suspends the MicroVM after the first job.
        // 5. So a caller that sees the MicroVM SUSPENDED while the gate is
        //    pending sees a suspend between the two jobs.
        // The callback result carries no data. So the handler ignores it.
        const [gate] = await sessionContext.createCallback("gate", {
          timeout: GATE_TIMEOUT,
        });
        await gate;

        // The service resumes the suspended MicroVM on this job's request.
        // A suspended MicroVM keeps its files. So this job reads the file
        // that the first job wrote.
        const read = await vm.invoke<{ microvmId: string; value: string }>(
          sessionContext,
          "read",
          { key: event.key },
          {
            path: "/read",
            timeout: { minutes: 5 },
            heartbeatTimeout: RESUMED_JOB_HEARTBEAT_TIMEOUT,
          },
        );

        return {
          sessionMicrovmId: vm.microvmId,
          writtenBy: written.microvmId,
          readBy: read.microvmId,
          value: read.value,
        };
      },
    );
  },
);
