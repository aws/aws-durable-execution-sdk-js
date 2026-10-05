import { randomUUID } from "crypto";
import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./microvm-session";

createTests({
  handler,
  // The local runner cannot launch a MicroVM.
  cloudOnly: true,
  tests: (runner, { assertEventSignatures }) => {
    it("runs both jobs in the same MicroVM", async () => {
      const key = randomUUID();

      const execution = await runner.run({ payload: { key } });

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
      const result = execution.getResult() as {
        sessionMicrovmId: string;
        writtenBy: string;
        readBy: string;
        value: string;
      };
      // The second job read the file that the first job wrote, so both
      // jobs ran in the session's MicroVM.
      expect(result.value).toBe(`written-by-${key}`);
      expect(result.writtenBy).toBe(result.sessionMicrovmId);
      expect(result.readBy).toBe(result.sessionMicrovmId);

      // A job can finish before the invocation that waits for it ends. The
      // invocation then continues, and the execution has one invocation
      // fewer.
      assertEventSignatures(execution, undefined, {
        invocationCompletedDifference: 1,
      });
    });
  },
});
