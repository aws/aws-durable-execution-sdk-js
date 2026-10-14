import { createHash } from "crypto";
import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { expectMicrovmTerminated } from "../../shared/microvm-test-helpers";
import { handler } from "./microvm-run-job";

createTests({
  handler,
  // The local runner cannot launch a MicroVM.
  cloudOnly: true,
  tests: (runner, { assertEventSignatures }) => {
    it("runs the job in a MicroVM and returns the MicroVM's result", async () => {
      const text = "the quick brown fox jumps over the lazy dog";

      const execution = await runner.run({ payload: { text } });

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
      expect(execution.getResult()).toEqual({
        wordCount: 9,
        sha256: createHash("sha256").update(text).digest("hex"),
        microvmId: expect.any(String),
      });

      await expectMicrovmTerminated(
        (execution.getResult() as { microvmId: string }).microvmId,
      );

      // A job can finish before the invocation that waits for it ends. The
      // invocation then continues, and the execution has one invocation
      // fewer.
      assertEventSignatures(execution, undefined, {
        invocationCompletedDifference: 1,
      });
    });
  },
});
