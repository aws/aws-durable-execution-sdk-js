import { handler } from "./parallel-heterogeneous";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should handle branches with different return types", async () => {
      const execution = await runner.run();

      const result = execution.getResult() as Array<
        { step1: string } | string | number
      >;
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ step1: "completed" });
      expect(result[1]).toBe("task 2 completed");
      expect(result[2]).toBe(42);

      assertEventSignatures(execution);
    });
  },
});
