import { randomUUID } from "crypto";
import { InvocationType } from "@aws-sdk/client-lambda";
import {
  ExecutionStatus,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import {
  expectMicrovmTerminated,
  observeMicrovmStates,
} from "../../shared/microvm-test-helpers";
import { handler } from "./microvm-session";

createTests({
  handler,
  // The test waits for the data of the write operation. The cloud runner
  // can wait for operation data only for an Event invocation.
  invocationType: InvocationType.Event,
  // The local runner cannot launch a MicroVM.
  cloudOnly: true,
  tests: (runner, { assertEventSignatures }) => {
    // The launch, the suspend, the 30-second wait, the auto-resume and the
    // terminate can take longer than the 120-second default timeout. So the
    // test sets its own timeout of 240 seconds.
    it("suspends the MicroVM between the jobs, and resumes it with the file of the first job", async () => {
      const key = randomUUID();

      const executionPromise = runner.run({ payload: { key } });
      // The write job's child context completes after the SuspendMicrovm
      // call. The 30-second wait follows. So the state is read during the
      // wait, for at most 25 seconds.
      const write = runner.getOperation("write");
      await write.waitForData(WaitingOperationStatus.COMPLETED);
      const microvmId = (
        write.getContextDetails()?.result as { microvmId?: string } | undefined
      )?.microvmId;
      expect(microvmId).toEqual(expect.any(String));
      const states = await observeMicrovmStates(
        microvmId as string,
        "SUSPENDED",
        25_000,
      );
      const execution = await executionPromise;

      expect(states).toContain("SUSPENDED");

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
      const result = execution.getResult() as {
        sessionMicrovmId: string;
        writtenBy: string;
        readBy: string;
        value: string;
      };
      // The second job read the file that the first job wrote, so both
      // jobs ran in the session's MicroVM, and the auto-resume kept the
      // file.
      expect(result.value).toBe(`written-by-${key}`);
      expect(result.writtenBy).toBe(result.sessionMicrovmId);
      expect(result.readBy).toBe(result.sessionMicrovmId);

      await expectMicrovmTerminated(result.sessionMicrovmId);

      // The number of invocations depends on how fast each job finishes.
      // A job can finish before the invocation that waits for it ends. The
      // invocation then continues, so the execution has one invocation
      // fewer. A slow job makes the invocation suspend, so the execution has
      // one invocation more. Each of the two jobs can go either way. So the
      // count can differ from the history by up to 2.
      assertEventSignatures(execution, undefined, {
        invocationCompletedDifference: 2,
      });
    }, 240_000);
  },
});
