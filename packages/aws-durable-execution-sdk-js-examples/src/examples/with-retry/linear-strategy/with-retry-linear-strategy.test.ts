import { EventType } from "@aws-sdk/client-lambda";
import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./with-retry-linear-strategy";
import { createTests } from "../../../utils/test-helper";

/**
 * The recorded backoff delays, in seconds.
 *
 * This is the only example test that reaches for raw history events. It has to:
 * the durations are not exposed on the operations API, and
 * `assertEventSignatures` compares only {EventType, SubType, Name} and excludes
 * Wait durations — so an exponential strategy retrying the same number of times
 * produces a byte-identical signature. The durations are the only thing that
 * identifies the strategy.
 */
function waitDurationsOf(execution: {
  getHistoryEvents: () => {
    EventType?: string;
    WaitStartedDetails?: { Duration?: number };
  }[];
}): (number | undefined)[] {
  return execution
    .getHistoryEvents()
    .filter((event) => event.EventType === EventType.WaitStarted)
    .map((event) => event.WaitStartedDetails?.Duration);
}

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should retry with linear backoff and succeed on the fourth attempt", async () => {
      const execution = await runner.run({ payload: { succeedOnAttempt: 4 } });

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      // Attempts 1, 2 and 3 fail, attempt 4 succeeds. The count is returned from
      // inside the retried function, so it survives replay.
      expect(execution.getResult()).toEqual({
        message: "request confirmed on attempt 4",
        attempts: 4,
      });

      // Three delays are needed, not two: exponential backoff from the same 1s
      // initial delay also produces 1s then 2s, so [1, 2] would pass for either
      // strategy. Only the third delay separates them — linear 3s against
      // exponential 4s.
      expect(waitDurationsOf(execution)).toEqual([1, 2, 3]);

      assertEventSignatures(execution);
    });

    it("should exhaust its retries and propagate the last error", async () => {
      // Above maxAttempts (5), so every attempt fails and the strategy stops
      // retrying — the `attemptsMade >= maxAttempts` branch.
      const execution = await runner.run({
        payload: { succeedOnAttempt: 9, maxDelaySeconds: 3 },
      });

      expect(execution.getStatus()).toBe(ExecutionStatus.FAILED);

      // The error from the LAST attempt propagates, not the first.
      expect(execution.getError()?.errorMessage).toContain(
        "Upstream temporarily unavailable (attempt 5)",
      );

      // Four delays for five attempts, with maxDelay lowered to 3s so the
      // fourth is clamped: the linear formula would give 4s. The success case
      // leaves maxDelay generous on purpose -- clamping there would collapse
      // [1, 2, 3] onto exponential's [1, 2, 4 -> 3] and the assertion above
      // would stop distinguishing the two strategies.
      expect(waitDurationsOf(execution)).toEqual([1, 2, 3, 3]);

      assertEventSignatures(execution, "exhausted");
    });
  },
});
