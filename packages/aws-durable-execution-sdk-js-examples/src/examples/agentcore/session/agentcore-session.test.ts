import { createHash } from "crypto";
import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./agentcore-session";

const count = (text: string) => ({
  wordCount: text.split(/\s+/).filter(Boolean).length,
  sha256: createHash("sha256").update(text).digest("hex"),
  sessionId: expect.any(String),
});

createTests({
  handler,
  // The local runner cannot start an AgentCore Runtime session.
  cloudOnly: true,
  tests: (runner, { assertEventSignatures }) => {
    it("runs both jobs in one AgentCore Runtime session and returns both results", async () => {
      const draft = "the quick brown fox";
      const final = "the quick brown fox jumps over the lazy dog";

      const execution = await runner.run({ payload: { draft, final } });

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
      expect(execution.getResult()).toEqual({
        draft: count(draft),
        final: count(final),
        sessionId: expect.any(String),
      });

      // Each job reports the session ID from its request header. Both are
      // the ID that the session step generated.
      const sessionStep = execution
        .getOperations()
        .find((operation) => operation.getName() === "word-counts.session");
      const result = execution.getResult() as {
        draft: { sessionId: string };
        final: { sessionId: string };
        sessionId: string;
      };
      expect(result.sessionId).toBe(sessionStep?.getStepDetails()?.result);
      expect(result.draft.sessionId).toBe(result.sessionId);
      expect(result.final.sessionId).toBe(result.sessionId);

      // A job can finish before the invocation that waits for it ends. The
      // invocation then continues, and the execution has one invocation
      // fewer for each such job.
      assertEventSignatures(execution, undefined, {
        invocationCompletedDifference: 2,
      });
    });
  },
});
