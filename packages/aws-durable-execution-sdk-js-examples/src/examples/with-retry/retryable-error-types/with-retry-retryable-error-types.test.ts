import {
  OperationStatus,
  OperationType,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./with-retry-retryable-error-types";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should retry errors matching a retryable error TYPE and then succeed", async () => {
      const step = runner.getOperation("call-flaky-api");
      const execution = await runner.run({ payload: { mode: "type" } });

      // RateLimitError matches retryableErrorTypes, so attempts 1 and 2 are
      // retried and attempt 3 succeeds.
      expect(execution.getResult()).toBe("api call succeeded on attempt 3");
      expect(step.getType()).toBe(OperationType.STEP);
      expect(step.getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(step.getStepDetails()?.attempt).toBe(3);

      assertEventSignatures(execution, "type");
    });

    it("should retry errors matching a retryable message PATTERN and then succeed", async () => {
      const step = runner.getOperation("call-flaky-api");
      const execution = await runner.run({ payload: { mode: "message" } });

      // A generic Error whose message contains "throttled" matches
      // retryableErrors, so it is retried until it succeeds on attempt 3.
      expect(execution.getResult()).toBe("api call succeeded on attempt 3");
      expect(step.getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(step.getStepDetails()?.attempt).toBe(3);

      assertEventSignatures(execution, "message");
    });

    it("should fail immediately on an error that matches neither filter", async () => {
      const step = runner.getOperation("call-flaky-api");
      const execution = await runner.run({
        payload: { mode: "non-retryable" },
      });

      // ValidationError is neither a RateLimitError nor does its message match
      // "throttled", so the strategy returns shouldRetry: false. The step fails
      // on the very first attempt with no retries.
      const error = execution.getError();
      expect(error).toMatchObject({
        errorType: "StepError",
        errorMessage: "Field 'amount' must be a positive number",
      });
      expect(step.getStatus()).toBe(OperationStatus.FAILED);
      expect(step.getStepDetails()?.attempt).toBe(1);

      assertEventSignatures(execution, "non-retryable");
    });
  },
});
