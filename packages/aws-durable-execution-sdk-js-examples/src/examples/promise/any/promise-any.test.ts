import { handler } from "./promise-any";
import { createTests } from "../../../utils/test-helper";
import { EventType, ExecutionStatus } from "@aws-sdk/client-lambda";
import { OperationStatus, OperationType } from "@aws/durable-execution-sdk-js";

createTests<string>({
  handler,
  localRunnerConfig: {
    // Time-skipping results in extra retries, since retry timers will finish
    // Instantly. Disabling time-skipping to stabilize the number of retries.
    skipTime: false,
  },
  tests: (runner, { assertEventSignatures }) => {
    it("should return first successful promise result", async () => {
      const execution = await runner.run();

      expect(execution.getOperations()).toHaveLength(4);

      const result = execution.getResult();
      expect(result).toBe("first success");

      assertEventSignatures(execution, "success");
    });

    it("should fail if all promises fail - failure case", async () => {
      const execution = await runner.run({
        payload: {
          shouldFail: true,
        },
      });

      expect(execution.getError()).toEqual({
        errorMessage: "All promises were rejected",
        errorType: "PromiseCombinatorError",
        errorData: undefined,
        stackTrace: undefined,
      });
      expect(execution.getOperations()).toHaveLength(4);

      expect(execution.getStatus()).toBe(ExecutionStatus.FAILED);
      expect(() => execution.getResult()).toThrow("All promises were rejected");

      const stepCount = 3;
      const maxAttempts = 3;
      const history = execution.getHistoryEvents();
      const steps = execution
        .getOperations()
        .filter((operation) => operation.getType() === OperationType.STEP);
      expect(steps).toHaveLength(stepCount);
      expect(
        steps.map((step) => ({
          status: step.getStatus(),
          starts: history.filter(
            (event) =>
              event.Id === step.getId() &&
              event.EventType === EventType.StepStarted,
          ).length,
          failures: history.filter(
            (event) =>
              event.Id === step.getId() &&
              event.EventType === EventType.StepFailed,
          ).length,
          result: step.getStepDetails()?.result,
          error: step.getStepDetails()?.error,
        })),
      ).toEqual(
        ["failure 1", "ERROR 1", "ERROR 2"].map((errorMessage) => ({
          status: OperationStatus.FAILED,
          starts: maxAttempts,
          failures: maxAttempts,
          result: undefined,
          error: {
            errorMessage,
            errorType: "Error",
            errorData: undefined,
            stackTrace: undefined,
          },
        })),
      );

      // Each step has two independent retry wakeups. A wakeup can be consumed
      // by an active invocation or start a new one after suspension, so there
      // are at most the initial invocation plus one per retry (1 + 3 * 2).
      // Disabling time skipping does not guarantee that wakeups are coalesced.
      const invocationCount = history.filter(
        (event) => event.EventType === EventType.InvocationCompleted,
      ).length;
      expect(invocationCount).toBeGreaterThanOrEqual(1);
      expect(invocationCount).toBeLessThanOrEqual(
        1 + stepCount * (maxAttempts - 1),
      );

      assertEventSignatures(execution, "failure", {
        // The history has one invocation per attempt with all retries coalesced.
        // Separately delivered retries can add one invocation per other step
        // in each retry round. All other event counts must still match exactly.
        invocationCompletedDifference: (stepCount - 1) * (maxAttempts - 1),
      });
    });
  },
});
