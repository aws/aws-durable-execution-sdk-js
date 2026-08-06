import { handler } from "./with-retry-linear-strategy";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should retry with linear backoff and succeed on the third attempt", async () => {
      const execution = await runner.run({ payload: { succeedOnAttempt: 3 } });

      // Attempts 1 and 2 fail, attempt 3 succeeds.
      expect(execution.getResult()).toEqual({
        message: "request confirmed on attempt 3",
        attempts: 3,
      });

      // The backoff DURATIONS are what make this strategy linear, and they are
      // not covered by assertEventSignatures — the event signature is only
      // {EventType, SubType, Name}, so an exponential strategy retrying twice
      // would produce a byte-identical signature. Assert the actual delays:
      // initialDelay 1s + increment 1s per attempt, with JitterStrategy.NONE
      // keeping them exact.
      const waitDurations = execution
        .getHistoryEvents()
        .filter((event) => event.EventType === "WaitStarted")
        .map((event) => event.WaitStartedDetails?.Duration);

      expect(waitDurations).toEqual([1, 2]);

      assertEventSignatures(execution);
    });
  },
});
