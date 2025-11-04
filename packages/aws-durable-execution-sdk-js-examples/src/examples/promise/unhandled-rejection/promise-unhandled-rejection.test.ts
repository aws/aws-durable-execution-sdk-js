import { handler } from "./promise-unhandled-rejection";
import { createTests } from "../../../utils/test-helper";

interface PromiseUnhandledRejectionResult {
  successStep: string;
  scenariosTested: string[];
}

createTests({
  name: "promise-unhandled-rejection",
  functionName: "promise-unhandled-rejection",
  localRunnerConfig: {
    skipTime: false,
  },
  handler,
  tests: (runner) => {
    it("should complete successfully despite failing steps in promise combinators", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as PromiseUnhandledRejectionResult;

      expect(result).toStrictEqual({
        successStep: "Success",
        scenariosTested: [
          "basic-promise-all",
          "immediate-combinator-usage",
          "combinator-after-operations",
          "combinator-after-wait-replay",
        ],
      });
    }, 30000);
  },
});
