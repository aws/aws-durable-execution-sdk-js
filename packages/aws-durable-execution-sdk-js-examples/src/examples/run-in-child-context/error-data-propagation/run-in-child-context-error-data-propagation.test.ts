import { handler } from "./run-in-child-context-error-data-propagation";
import { createTests } from "../../../utils/test-helper";

const SENTINEL = JSON.stringify({ reason: "operator-cancelled" });

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should preserve errorData across nested runInChildContext boundaries", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // This is the key assertion for issue #524:
      // errorData must survive 2+ runInChildContext boundary crossings
      expect(result.found).toBe(true);
      expect(result.errorData).toBe(SENTINEL);

      assertEventSignatures(execution);
    });
  },
});
