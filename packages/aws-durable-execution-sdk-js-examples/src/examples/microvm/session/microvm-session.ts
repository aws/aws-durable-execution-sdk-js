import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { microvmSession } from "@aws/durable-execution-sdk-js-extras/compute/microvm";
import { ExampleConfig } from "../../../types";
import { requireMicrovmEnv } from "../../shared/microvm-env";

export const config: ExampleConfig = {
  name: "MicroVM Session",
  description:
    "Runs two jobs in one Lambda MicroVM, and suspends the MicroVM during the durable wait between them",
  durableConfig: {
    ExecutionTimeout: 900,
    RetentionPeriodInDays: 7,
  },
  usesMicrovm: true,
};

export const handler = withDurableExecution(
  async (event: { key: string }, context: DurableContext) => {
    const { imageArn, executionRoleArn } = requireMicrovmEnv();

    // The session launches one MicroVM and terminates it when the handler
    // returns. Each vm.invoke sends one job over HTTP to a route of the app
    // in the MicroVM.
    return microvmSession(
      context,
      "file-session",
      {
        imageIdentifier: imageArn,
        executionRoleArn,
        timeout: { minutes: 10 },
      },
      async (vm, sessionContext) => {
        const written = await vm.invoke<{ microvmId: string }>(
          sessionContext,
          "write",
          { key: event.key, value: `written-by-${event.key}` },
          {
            path: "/write",
            timeout: { minutes: 5 },
            heartbeatTimeout: { seconds: 30 },
            // The durable function suspends the MicroVM after this job's
            // result arrives. The function's role needs
            // lambda:SuspendMicrovm on the MicroVM image.
            suspendAfter: true,
          },
        );

        // The wait ends this invocation. The MicroVM stays suspended during
        // the wait, and keeps its memory and files.
        await sessionContext.wait("pause", { seconds: 30 });

        // The session checks the MicroVM state before this job and resumes
        // the suspended MicroVM. So this job finds the file that the first
        // job wrote.

        const read = await vm.invoke<{ microvmId: string; value: string }>(
          sessionContext,
          "read",
          { key: event.key },
          {
            path: "/read",
            timeout: { minutes: 5 },
            // The heartbeat timeout starts before the resume. After a
            // resume, the worker can refuse the job for up to 30 seconds. So
            // it is the default 60-second retryWindow plus 30 seconds.
            heartbeatTimeout: { seconds: 90 },
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
