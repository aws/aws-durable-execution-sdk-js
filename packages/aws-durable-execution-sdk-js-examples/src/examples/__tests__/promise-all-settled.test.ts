import { handler } from "../promise-all-settled";
import { createTests } from "./shared/test-helper";

createTests<PromiseSettledResult<any>[]>({
  name: "promise-all-settled test",
  functionName: "promise-all-settled",
  handler,
  localRunnerConfig: {
    skipTime: false,
  },
  tests: (runner) => {
    it("should complete all promises", async () => {
      const execution = await runner.run();

      expect(execution.getOperations()).toHaveLength(4);

      const result = execution.getResult();

      expect(result).toStrictEqual([
        {
          status: "fulfilled",
          value: "success",
        },
        {
          status: "rejected",
          reason: {
            name: "Error",
          },
        },
        {
          status: "fulfilled",
          value: "another success",
        },
      ]);
    }, 30000);
  },
});
