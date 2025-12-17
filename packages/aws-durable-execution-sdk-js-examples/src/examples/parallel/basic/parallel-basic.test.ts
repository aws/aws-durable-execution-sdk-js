import { handler } from "./parallel-basic";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should return correct result", async () => {
      const execution = await runner.run();

      const result = execution.getResult();

      expect(execution.getResult()).toBeDefined();
      expect(runner.getOperation("parallel").getChildOperations()).toHaveLength(
        3,
      );

      assertEventSignatures(execution);
    });
  },
});
