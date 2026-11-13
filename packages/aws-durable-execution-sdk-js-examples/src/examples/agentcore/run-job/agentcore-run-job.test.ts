import { createHash } from "crypto";
import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./agentcore-run-job";

createTests({
  handler,
  // The local runner cannot start an AgentCore Runtime session.
  cloudOnly: true,
  tests: (runner, { assertEventSignatures }) => {
    it("runs the job in an AgentCore Runtime session and returns the agent's result", async () => {
      const text = "the quick brown fox jumps over the lazy dog";

      const execution = await runner.run({ payload: { text } });

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
      expect(execution.getResult()).toEqual({
        wordCount: 9,
        sha256: createHash("sha256").update(text).digest("hex"),
        sessionId: expect.any(String),
      });

      // The agent reports the session ID from its request header. It is the
      // ID that the session step generated.
      const sessionStep = execution
        .getOperations()
        .find((operation) => operation.getName() === "count-words.session");
      expect((execution.getResult() as { sessionId: string }).sessionId).toBe(
        sessionStep?.getStepDetails()?.result,
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
