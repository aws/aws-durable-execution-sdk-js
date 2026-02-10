import { handler } from "./promise-all-settled";
import { createTests } from "../../../utils/test-helper";

createTests<PromiseSettledResult<any>[]>({
  handler,
  localRunnerConfig: {
    skipTime: false,
  },
  tests: (runner, { assertEventSignatures }) => {
    it("should complete all promises", async () => {
      const execution = await runner.run();

      expect(execution.getOperations()).toHaveLength(4);

      const result = execution.getResult();

      expect(result).toHaveLength(3);
      expect(result![0]).toEqual({ status: "fulfilled", value: "success" });
      expect(result![1].status).toBe("rejected");
      expect((result![1] as PromiseRejectedResult).reason.name).toBe(
        "StepError",
      );
      expect(result![2]).toEqual({
        status: "fulfilled",
        value: "another success",
      });

      assertEventSignatures(execution);
    }, 30000);
  },
});
