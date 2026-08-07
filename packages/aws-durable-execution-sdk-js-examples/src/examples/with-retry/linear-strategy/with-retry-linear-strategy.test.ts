import { handler } from "./with-retry-linear-strategy";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should retry with linear backoff and succeed on the fourth attempt", async () => {
      const execution = await runner.run({ payload: { succeedOnAttempt: 4 } });

      // Attempts 1, 2 and 3 fail, attempt 4 succeeds.
      expect(execution.getResult()).toEqual({
        message: "request confirmed on attempt 4",
        attempts: 4,
      });

      // The backoff DURATIONS are what make this strategy linear, and they are
      // not covered by assertEventSignatures — the event signature is only
      // {EventType, SubType, Name}, so an exponential strategy retrying would
      // produce a byte-identical signature. Assert the actual delays:
      // initialDelay 1s + increment 1s per attempt, with JitterStrategy.NONE
      // keeping them exact.
      //
      // Three delays are needed, not two: exponential backoff from the same 1s
      // initial delay also produces 1s then 2s, so [1, 2] would pass for either
      // strategy. Only the third delay separates them (linear 3s vs
      // exponential 4s).
      const waitDurations = execution
        .getHistoryEvents()
        .filter((event) => event.EventType === "WaitStarted")
        .map((event) => event.WaitStartedDetails?.Duration);

      expect(waitDurations).toEqual([1, 2, 3]);

      assertEventSignatures(execution);
    });
  },
});
