import { handler } from "./step-error-determinism";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should have deterministic error handling behavior through replay", async () => {
      const execution = await runner.run();

      const result = execution.getResult();

      expect(result).toBe(true);

      assertEventSignatures(execution);
    });
  },
});
