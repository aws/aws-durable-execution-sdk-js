import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { microvmSession } from "@aws/durable-execution-sdk-js-extras/microvm";
import { ExampleConfig } from "../../../types";
import { requireMicrovmEnv } from "../../shared/microvm-env";

export const config: ExampleConfig = {
  name: "MicroVM Session Suspend After",
  description:
    "Runs two jobs in one Lambda MicroVM that the worker suspends after the first",
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

// The second job waits for the resume. The worker can refuse it with HTTP 503
// for up to 30 seconds before that, and the request step retries for up to
// 60 seconds. So its heartbeat timeout is longer than both together.
const RESUMED_JOB_HEARTBEAT_TIMEOUT = { seconds: 120 };

export const handler = withDurableExecution(
  async (event: { key: string }, context: DurableContext) => {
    const { imageArn, executionRoleArn } = requireMicrovmEnv();

    // The session launches one MicroVM and terminates it when the handler
    // returns. It does not suspend when idle. The image enables the resume
    // hook. So the worker accepts the next job as soon as the MicroVM
    // resumes.
    return microvmSession(
      context,
      "suspend-after-session",
      {
        imageIdentifier: imageArn,
        executionRoleArn,
        timeout: { minutes: 10 },
      },
      async (vm, sessionContext) => {
        // The worker suspends the MicroVM when this job has ended and its
        // result is reported.
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
        // 4. So the worker suspends the MicroVM after the first job.
        // 5. So a caller that sees the MicroVM SUSPENDED while the gate is
        //    pending sees a suspend between the two jobs.
        // The callback result carries no data. So the handler ignores it.
        const [gate] = await sessionContext.createCallback("gate", {
          timeout: GATE_TIMEOUT,
        });
        await gate;

        // The first job set suspendAfter. So the request step calls
        // GetMicrovm, finds the MicroVM SUSPENDED, and calls ResumeMicrovm
        // before it sends the job. A suspended MicroVM keeps its files. So
        // this job reads the file that the first job wrote.
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
