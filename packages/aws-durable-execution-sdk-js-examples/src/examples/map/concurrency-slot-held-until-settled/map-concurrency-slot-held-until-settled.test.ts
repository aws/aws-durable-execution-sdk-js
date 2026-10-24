import { handler } from "./map-concurrency-slot-held-until-settled";
import { createTests } from "../../../utils/test-helper";

createTests<{ results: number[]; maxRunning: number }>({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("never runs two items at once with maxConcurrency 1", async () => {
      const execution = await runner.run();

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getResult()).toEqual({
        results: [0, 10, 20],
        // An item records its outcome before it deserializes its result. If
        // the slot were freed at that point, the next item would start while
        // the previous one still deserialized, and this would be 2.
        maxRunning: 1,
      });

      assertEventSignatures(execution);
    });
  },
});
