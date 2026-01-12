import { handler } from "./promise-all";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should complete all promises", async () => {
      const execution = await runner.run();

      expect(execution.getOperations()).toHaveLength(4);
    });

    it("should return correct result - happy case", async () => {
      const execution = await runner.run();

      expect(execution.getResult()).toStrictEqual([
        "result 1",
        "result 2",
        "result 3",
      ]);

      assertEventSignatures(execution);
    });
  },
});
