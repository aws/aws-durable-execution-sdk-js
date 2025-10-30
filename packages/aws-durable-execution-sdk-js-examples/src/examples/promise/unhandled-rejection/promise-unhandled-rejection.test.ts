import { handler } from "./promise-unhandled-rejection";
import { createTests } from "../../../utils/test-helper";

interface PromiseUnhandledRejectionResult {
  successStep: string;
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

      // The customer's example should return this exact result
      expect(result).toStrictEqual({
        successStep: "Success",
      });
    }, 30000);
  },
});
