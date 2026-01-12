import { handler } from "./run-in-child-context-failing-step";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should succeed despite failing step in child context", async () => {
      const execution = await runner.run();
      const result = execution.getResult();

      expect(result).toStrictEqual({ success: true });

      assertEventSignatures(execution);
    });
  },
});
