import { handler } from "./promise-combinators";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "promise-combinators",
  functionName: "promise-combinators",
  localRunnerConfig: {
    skipTime: false,
  },
  handler,
  tests: (runner) => {
    it("should execute all promise combinators successfully", async () => {
      const execution = await runner.run();

      const result = execution.getResult() as any;

      // Verify the structure of the result
      expect(result).toStrictEqual({
        message: "Promise combinators example completed successfully",
        allResults: [
          "Result from step 1",
          "Result from step 2",
          "Result from step 3",
        ],
        raceResult: "Fast result", // The fast result should win the race
        settledResults: [
          { status: "fulfilled", value: "Success!" },
          {
            status: "rejected",
            reason: {
              name: "StepError",
            },
          },
        ],
        anyResult: "First success!", // The successful promise should be returned
      });
    }, 30000);
  },
});
